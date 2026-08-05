from flask import Blueprint

from ..models.user_model import find_by_id

bp = Blueprint("users", __name__)


# Genuine route decorators. This fixture is named for Flask routing but held
# no decorators at all until v0.1.1, so the Python route pattern had zero
# fixture coverage in EITHER direction — nothing proved it detected a route,
# and nothing proved it declined a non-route. See docs/DECISIONS.md.
@bp.route("/users/<user_id>")
def handle_user(user_id: str) -> dict:
    return find_by_id(user_id)


@bp.route("/users", methods=["GET", "POST"])
def list_users() -> dict:
    return {"users": []}


# Two GENUINE routes stacked on one function, sharing a path. Both are real
# and both must be kept; they collided on `symbol.id` while a route symbol
# took its startLine from the enclosing `decorated_definition` rather than
# from its own decorator.
@bp.get("/users/<user_id>/profile")
@bp.post("/users/<user_id>/profile")
def profile(user_id: str) -> dict:
    return {"id": user_id}


# Decorators that are NOT routes and must never be emitted as such. `patch`
# is both an HTTP verb and the stdlib patcher, so the verb list alone cannot
# separate them — the leading-slash requirement on the path is what does.
@mock.patch("app.models.user_model.USERS")
def test_find_by_id(mocked) -> None:
    pass


@click.option("--verbose", "-v", is_flag=True)
@click.option("--quiet", "-v", is_flag=True)
def cli_entry(verbose: bool, quiet: bool) -> None:
    pass
