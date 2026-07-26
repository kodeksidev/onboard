import { analyzeFixtureRepo } from './support/repo';

const NONEXISTENT_PATH = 'C:/onboard-e2e-does-not-exist-9f3c2b';

/**
 * Section 11: "a deleted folder → the exact `E_PATH_NOT_FOUND` copy
 * appears." Analyzing a path that was never there reaches the identical
 * Rust validation branch (`commands::analyze::classify_metadata_error`,
 * `io::ErrorKind::NotFound`) a folder deleted after being chosen would —
 * without needing to create and delete a real directory mid-test.
 */
describe('errors', () => {
  it('shows the literal E_PATH_NOT_FOUND copy for a folder that does not exist', async () => {
    await analyzeFixtureRepo(NONEXISTENT_PATH);

    const alert = await $('[role="alert"]');
    await alert.waitForDisplayed({ timeout: 15_000 });

    const title = await $('#error-state-title');
    await expect(title).toHaveText('That folder no longer exists');

    const description = await $('p*=could not find');
    await expect(description).toBeDisplayed();

    const retryButton = await $('button=Retry');
    await expect(retryButton).toBeDisplayed();
  });
});
