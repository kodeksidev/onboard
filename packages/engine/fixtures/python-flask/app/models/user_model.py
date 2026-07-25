USERS = {"1": {"id": "1", "name": "Ada"}}


def find_by_id(user_id: str) -> dict:
    return USERS.get(user_id, {})
