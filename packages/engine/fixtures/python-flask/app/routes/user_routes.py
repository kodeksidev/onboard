from ..models.user_model import find_by_id


def handle_user(user_id: str) -> dict:
    return find_by_id(user_id)
