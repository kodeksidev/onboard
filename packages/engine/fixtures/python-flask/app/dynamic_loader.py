"""Exercises Section 8.2 rule 6: importlib.import_module(...) resolution."""
import importlib

# A literal string argument resolves with the same rules as a normal import.
user_model = importlib.import_module("app.models.user_model")


def load_plugin(module_name: str):
    """A non-literal argument is recorded as `dynamic-expression`, never resolved."""
    return importlib.import_module(module_name)
