"""Pytest path setup: make backend/ (the `app` package) importable.

Run from repo root:  pytest backend/tests/ -v
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
