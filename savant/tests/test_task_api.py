"""Regression tests for Task REST API endpoints.

These test the full HTTP round-trip including JSON serialization,
ensuring fields like task_id, seq, depends_on are always present.
"""

import sys, os, json
import pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _create_workspace(client, name="API Test WS"):
    resp = client.post("/api/workspaces", json={"name": name})
    return resp.get_json()["workspace_id"]


def _create_task(client, ws_id, title="Test task", **kwargs):
    payload = {"title": title, "workspace_id": ws_id, **kwargs}
    return client.post("/api/tasks", json=payload)


@pytest.fixture
def ws(client):
    """Create a workspace and return its id."""
    return _create_workspace(client)


class TestTaskApiCreate:
    """POST /api/tasks must return task with task_id and seq."""

    def test_create_returns_task_id(self, client, ws):
        resp = _create_task(client, ws, title="Hello")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("task_id"), "Response missing task_id"
        assert isinstance(data["task_id"], str)

    def test_create_returns_seq(self, client, ws):
        resp = _create_task(client, ws, title="With seq")
        data = resp.get_json()
        assert data.get("seq") is not None, "Response missing seq"
        assert isinstance(data["seq"], int)
        assert data["seq"] > 0

    def test_create_returns_depends_on(self, client, ws):
        resp = _create_task(client, ws, title="With deps")
        data = resp.get_json()
        assert "depends_on" in data, "Response missing depends_on"
        assert isinstance(data["depends_on"], list)

    def test_create_sets_defaults(self, client, ws):
        resp = _create_task(client, ws, title="Defaults check")
        data = resp.get_json()
        assert data["status"] == "todo"
        assert data["priority"] == "medium"

    def test_create_requires_title(self, client, ws):
        resp = client.post("/api/tasks", json={"workspace_id": ws})
        assert resp.status_code == 400


class TestTaskApiList:
    """GET /api/tasks with various filters."""

    def test_list_all(self, client, ws):
        _create_task(client, ws, title="T1")
        _create_task(client, ws, title="T2")
        resp = client.get("/api/tasks")
        data = resp.get_json()
        assert len(data) == 2

    def test_list_by_workspace(self, client):
        ws_a = _create_workspace(client, "WS A")
        ws_b = _create_workspace(client, "WS B")
        _create_task(client, ws_a, title="In A")
        _create_task(client, ws_b, title="In B")
        resp = client.get(f"/api/tasks?workspace_id={ws_a}")
        data = resp.get_json()
        assert len(data) == 1
        assert data[0]["title"] == "In A"

    def test_list_by_workspace_returns_all_dates(self, client, ws):
        """REGRESSION: workspace task list must not filter by date."""
        _create_task(client, ws, title="Day 1", date="2099-06-01")
        _create_task(client, ws, title="Day 2", date="2099-06-02")
        _create_task(client, ws, title="Day 3", date="2099-06-03")
        resp = client.get(f"/api/tasks?workspace_id={ws}")
        data = resp.get_json()
        assert len(data) == 3, f"Expected 3 tasks across all dates, got {len(data)}"
        dates = {t["date"] for t in data}
        assert dates == {"2099-06-01", "2099-06-02", "2099-06-03"}

    def test_list_all_tasks_have_task_id(self, client, ws):
        """REGRESSION: every task in list must have task_id (not just 'id')."""
        _create_task(client, ws, title="T1")
        _create_task(client, ws, title="T2")
        resp = client.get("/api/tasks")
        for t in resp.get_json():
            assert t.get("task_id"), f"Task missing task_id: {t}"

    def test_list_all_tasks_have_seq(self, client, ws):
        """REGRESSION: every task in list must have seq number."""
        _create_task(client, ws, title="T1")
        _create_task(client, ws, title="T2")
        resp = client.get("/api/tasks")
        for t in resp.get_json():
            assert t.get("seq") is not None, f"Task missing seq: {t}"

    def test_list_all_tasks_have_depends_on(self, client, ws):
        """REGRESSION: every task in list must have depends_on array."""
        _create_task(client, ws, title="T1")
        resp = client.get("/api/tasks")
        for t in resp.get_json():
            assert "depends_on" in t, f"Task missing depends_on: {t}"
            assert isinstance(t["depends_on"], list)

    def test_list_by_date(self, client, ws):
        _create_task(client, ws, title="Today", date="2026-03-22")
        _create_task(client, ws, title="Tomorrow", date="2026-03-23")
        resp = client.get("/api/tasks?date=2026-03-22&today=2026-03-22")
        data = resp.get_json()
        assert len(data) == 1
        assert data[0]["title"] == "Today"

    def test_empty_workspace_returns_empty(self, client, ws):
        resp = client.get(f"/api/tasks?workspace_id={ws}")
        assert resp.get_json() == []


class TestTaskApiUpdate:
    """PUT /api/tasks/<id> must persist changes and return full task."""

    def test_update_status(self, client, ws):
        task = _create_task(client, ws, title="Update me").get_json()
        tid = task["task_id"]
        resp = client.put(f"/api/tasks/{tid}", json={"status": "in-progress"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "in-progress"
        # Verify persistence
        refetch = client.get("/api/tasks").get_json()
        assert refetch[0]["status"] == "in-progress"

    def test_update_preserves_seq(self, client, ws):
        """REGRESSION: updating a task must not lose its seq number."""
        task = _create_task(client, ws, title="Seq check").get_json()
        original_seq = task["seq"]
        resp = client.put(f"/api/tasks/{task['task_id']}", json={"status": "done"})
        assert resp.get_json()["seq"] == original_seq

    def test_update_preserves_workspace(self, client, ws):
        """REGRESSION: status update must not clear workspace_id."""
        task = _create_task(client, ws, title="WS check").get_json()
        resp = client.put(f"/api/tasks/{task['task_id']}", json={"status": "done"})
        assert resp.get_json()["workspace_id"] == ws

    def test_update_workspace_move(self, client):
        """Moving a task between workspaces must persist."""
        ws_a = _create_workspace(client, "A")
        ws_b = _create_workspace(client, "B")
        task = _create_task(client, ws_a, title="Movable").get_json()
        resp = client.put(f"/api/tasks/{task['task_id']}", json={"workspace_id": ws_b})
        assert resp.get_json()["workspace_id"] == ws_b
        # Must now appear in ws-b, not ws-a
        a_tasks = client.get(f"/api/tasks?workspace_id={ws_a}").get_json()
        b_tasks = client.get(f"/api/tasks?workspace_id={ws_b}").get_json()
        assert len(a_tasks) == 0
        assert len(b_tasks) == 1

    def test_update_nonexistent_404(self, client):
        resp = client.put("/api/tasks/fake-id", json={"status": "done"})
        assert resp.status_code == 404


class TestTaskApiDelete:
    """DELETE /api/tasks/<id> must remove the task."""

    def test_delete_task(self, client, ws):
        task = _create_task(client, ws, title="Delete me").get_json()
        resp = client.delete(f"/api/tasks/{task['task_id']}")
        assert resp.status_code == 200
        # Verify gone
        remaining = client.get("/api/tasks").get_json()
        assert len(remaining) == 0

    def test_delete_nonexistent(self, client):
        resp = client.delete("/api/tasks/fake-id")
        assert resp.status_code in (404, 200)


class TestSearchTaskRegression:
    """Workspace search must return task id and seq."""

    def test_search_returns_task_id(self, client, ws):
        _create_task(client, ws, title="Searchable unicorn task")
        resp = client.get("/api/workspaces/search?q=unicorn")
        data = resp.get_json()
        tasks = data.get("tasks", [])
        assert len(tasks) == 1
        assert tasks[0].get("id"), "Search result missing id"

    def test_search_returns_seq(self, client, ws):
        _create_task(client, ws, title="Searchable dragon task")
        resp = client.get("/api/workspaces/search?q=dragon")
        data = resp.get_json()
        tasks = data.get("tasks", [])
        assert len(tasks) == 1
        assert tasks[0].get("seq") is not None, "Search result missing seq"
