//! `ai/rate_limit.rs` — Section 9 Phase 12 / Section 12: "AI:
//! `AI_MAX_REQUESTS_PER_MINUTE = 10`, `AI_MAX_CONCURRENT = 1` ... no
//! automatic retry."
//!
//! Both limits are enforced in ONE place, by [`AiRateLimiter::acquire`],
//! and both are released the same way: the returned [`AiRequestSlot`] is an
//! RAII guard whose `Drop` clears the in-flight flag. That matters because
//! the pipeline this guards is a chain of `?`-propagating fallible steps —
//! a hand-managed "decrement at the end" would leak the concurrency slot
//! on every error path, permanently wedging the feature after the first
//! network failure.
//!
//! A REFUSED request records nothing: it consumes no window capacity and
//! sets no in-flight flag, so a caller retrying in a tight loop cannot
//! extend its own lockout (proved by
//! `tests::a_refused_request_does_not_consume_window_capacity`).
//!
//! `acquire_at` takes the current instant as a parameter so the sliding
//! window is testable at the exact boundary (10 allowed, the 11th refused,
//! capacity back after 60s) without a 61-second sleep. `acquire` is the
//! production entry point and simply passes `Instant::now()`.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use crate::constants::{AI_MAX_CONCURRENT, AI_MAX_REQUESTS_PER_MINUTE, AI_RATE_LIMIT_WINDOW};
use crate::error::AppError;

#[derive(Debug, Default)]
struct Inner {
    /// Start instants of the requests admitted inside the current window,
    /// oldest first. Bounded by `AI_MAX_REQUESTS_PER_MINUTE`.
    admitted: VecDeque<Instant>,
    in_flight: usize,
}

/// Shared, `Arc`-backed so an [`AiRequestSlot`] is an owned `'static`
/// value rather than a borrow of `AppState`. The pipeline holds its slot
/// across the `.await` on the provider call, and a borrow there would pin
/// `AppState` inside the command future for no reason. `Clone` shares the
/// same counters (it is never an independent limiter).
#[derive(Debug, Default, Clone)]
pub struct AiRateLimiter {
    inner: Arc<Mutex<Inner>>,
}

/// Proof that a request was admitted. Releasing it (by drop) is the only
/// way the in-flight count comes back down.
#[derive(Debug)]
pub struct AiRequestSlot {
    inner: Arc<Mutex<Inner>>,
}

impl Drop for AiRequestSlot {
    fn drop(&mut self) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        inner.in_flight = inner.in_flight.saturating_sub(1);
    }
}

impl AiRateLimiter {
    pub fn new() -> Self {
        AiRateLimiter::default()
    }

    pub fn acquire(&self) -> Result<AiRequestSlot, AppError> {
        self.acquire_at(Instant::now())
    }

    pub(crate) fn acquire_at(&self, now: Instant) -> Result<AiRequestSlot, AppError> {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);

        if inner.in_flight >= AI_MAX_CONCURRENT {
            return Err(AppError::ai_request_already_in_flight());
        }

        while inner
            .admitted
            .front()
            .is_some_and(|started| now.duration_since(*started) >= AI_RATE_LIMIT_WINDOW)
        {
            inner.admitted.pop_front();
        }

        if inner.admitted.len() >= AI_MAX_REQUESTS_PER_MINUTE {
            let oldest = *inner
                .admitted
                .front()
                .expect("non-empty by the check above");
            let elapsed = now.duration_since(oldest);
            let retry_after = AI_RATE_LIMIT_WINDOW.saturating_sub(elapsed).as_secs() + 1;
            return Err(AppError::ai_rate_limited_locally(retry_after));
        }

        inner.admitted.push_back(now);
        inner.in_flight += 1;
        Ok(AiRequestSlot {
            inner: Arc::clone(&self.inner),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::constants::{AI_MAX_CONCURRENT, AI_MAX_REQUESTS_PER_MINUTE};
    use std::time::Duration;

    #[test]
    fn the_constants_match_section_12() {
        assert_eq!(AI_MAX_REQUESTS_PER_MINUTE, 10);
        assert_eq!(AI_MAX_CONCURRENT, 1);
    }

    /// Ten requests inside one minute are fine; the eleventh is refused
    /// with `E_AI_RATE_LIMITED` — the exact boundary, not "roughly ten".
    #[test]
    fn the_eleventh_request_in_a_minute_is_refused() {
        let limiter = AiRateLimiter::new();
        let start = Instant::now();
        for i in 0..AI_MAX_REQUESTS_PER_MINUTE {
            let slot = limiter
                .acquire_at(start + Duration::from_millis(i as u64))
                .unwrap_or_else(|e| panic!("request {i} should have been allowed: {e:?}"));
            drop(slot);
        }
        let err = limiter
            .acquire_at(start + Duration::from_millis(AI_MAX_REQUESTS_PER_MINUTE as u64))
            .expect_err("the 11th request in the window must be refused");
        assert_eq!(err.code, "E_AI_RATE_LIMITED");
    }

    /// The window really is a sliding minute: once the oldest request ages
    /// out, capacity comes back. Without this, "refused" could be
    /// permanent, which is a different (and broken) behavior.
    #[test]
    fn capacity_returns_once_the_window_has_passed() {
        let limiter = AiRateLimiter::new();
        let start = Instant::now();
        for i in 0..AI_MAX_REQUESTS_PER_MINUTE {
            drop(
                limiter
                    .acquire_at(start + Duration::from_millis(i as u64))
                    .unwrap(),
            );
        }
        assert!(limiter.acquire_at(start + Duration::from_secs(1)).is_err());
        let later = limiter.acquire_at(start + Duration::from_secs(61));
        assert!(later.is_ok(), "capacity must return after the window");
    }

    /// `AI_MAX_CONCURRENT = 1`: a second request while one is still in
    /// flight is refused, and the slot is released by `Drop` (so an early
    /// `?` return inside the pipeline cannot leak the permit).
    #[test]
    fn a_second_concurrent_request_is_refused_and_the_slot_is_released_on_drop() {
        let limiter = AiRateLimiter::new();
        let start = Instant::now();
        let held = limiter.acquire_at(start).expect("first request allowed");
        let err = limiter
            .acquire_at(start + Duration::from_millis(1))
            .expect_err("a concurrent request must be refused");
        assert_eq!(err.code, "E_AI_RATE_LIMITED");
        drop(held);
        assert!(limiter.acquire_at(start + Duration::from_millis(2)).is_ok());
    }

    /// A refused request must not consume window capacity — otherwise a
    /// caller hammering the limiter would extend its own lockout forever.
    #[test]
    fn a_refused_request_does_not_consume_window_capacity() {
        let limiter = AiRateLimiter::new();
        let start = Instant::now();
        let held = limiter.acquire_at(start).unwrap();
        for i in 1..20 {
            assert!(limiter
                .acquire_at(start + Duration::from_millis(i))
                .is_err());
        }
        drop(held);
        // One request has been recorded so far, so nine more must fit.
        for i in 0..(AI_MAX_REQUESTS_PER_MINUTE - 1) {
            drop(
                limiter
                    .acquire_at(start + Duration::from_millis(100 + i as u64))
                    .unwrap_or_else(|e| panic!("post-refusal request {i} must be allowed: {e:?}")),
            );
        }
    }
}
