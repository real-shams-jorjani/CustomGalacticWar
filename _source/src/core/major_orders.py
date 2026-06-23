"""Pure, capable Major Order (Assignment) builders — the single source of
truth shared by the standalone ``mo.py`` prototype and the in-editor tool.

A Major Order is deployed by *overwriting* the assignment endpoint with the
full array of orders (plus, optionally, an in-game briefing pop-up):

    [ { "function": "OverwriteEndpoint",
        "endpoint": "/api/v2/Assignment/War/801",
        "value": [ <assignment>, ... ] },                # the orders
      { "function": "SaveGlobalEvent",                   # optional briefing
        "eventId": <id32>, "data": <briefing> } ]

``OverwriteEndpoint`` REPLACES the whole endpoint, so every order that should
survive a deploy must be present in ``value``.

The fiddly part is the task encoding. Each task is
``{type, values[], valueTypes[]}`` and is **position-independent**: a reader
finds a field's meaning by scanning ``valueTypes`` for that field's code, then
reads ``values`` at the same index. The code→meaning map below is lifted from
the API bot's authoritative ``assignment_layout.json`` and cross-checked
against live orders, so this module can build every task type the game
supports — not just the handful the first prototype covered.

Everything here is pure (no Qt, no Tk, no I/O) so any front end can reuse it —
including :class:`MajorOrderSession` (bottom of file), the stateful controller
the Tk prototype and the eventual Qt editor tool are both thin views over.
"""
from __future__ import annotations

import copy

# ---------------------------------------------------------------------------
# Decode tables (authoritative — mirror plugins/discord_bot/design/
# assignment_layout.json, cross-checked against live war 801 orders).
# ---------------------------------------------------------------------------

# Assignment setting.type is always 4 for a player assignment.
SETTING_TYPE = 4

# task.type → human label.
TASK_TYPES = {
    2: "Extract",            # extract N samples/items (uses item_id)
    3: "Eradicate",          # kill N of a faction (optionally a unit_id)
    7: "Complete Missions",  # vs a faction (optionally at a difficulty)
    9: "Complete Operations",
    11: "Liberation",        # liberate a planet
    12: "Defense",           # defend against N attacks
    13: "Control",           # hold a planet
    15: "Expand",            # tug-of-war: liberate more than is lost
}

# valueType code → semantic field name. The "unknown_*" codes appear in live
# orders with stable filler values (0/1); their exact purpose is unconfirmed.
VALUE_TYPES = {
    1: "race",            # faction id (0 = any)
    2: "unknown_2",
    3: "goal",            # target amount / count
    4: "unit_id",         # a specific enemy unit to kill
    5: "item_id",         # the item/sample being extracted
    6: "unknown_6",
    8: "unknown_8",
    9: "difficulty",      # minimum mission difficulty
    11: "location_type",  # scope of the location_index (planet/sector/...)
    12: "location_index",  # planet index
}

# Named valueType codes — used by the builder so the encoding is readable.
VT_RACE = 1
VT_UNKNOWN_2 = 2
VT_GOAL = 3
VT_UNIT_ID = 4
VT_ITEM_ID = 5
VT_DIFFICULTY = 9
VT_LOCATION_TYPE = 11
VT_LOCATION_INDEX = 12

FACTIONS = {1: "SUPER EARTH", 2: "TERMINIDS", 3: "AUTOMATONS", 4: "ILLUMINATE"}

# Reward kinds (setting.rewards[].type) and the default item id the prototype
# used for medals. The game distinguishes the kind by ``type``; ``id32`` is the
# specific item.
REWARD_MEDALS = 1
REWARD_REQUISITION = 2
REWARD_TYPES = {REWARD_MEDALS: "Medals", REWARD_REQUISITION: "Requisition Slips"}
DEFAULT_MEDAL_ITEM_ID = 897894480

# Which builder kwargs each task type meaningfully consumes — drives a front
# end's task form so it shows only the relevant inputs (the bracketed ones are
# optional advanced slots).
TASK_FIELDS = {
    11: ("planet",),
    13: ("planet",),
    3:  ("faction", "goal", "[unit_id]"),
    7:  ("faction", "goal", "[difficulty]"),
    9:  ("faction", "goal", "[difficulty]"),
    12: ("faction", "goal"),
    15: ("goal",),
    2:  ("faction", "goal", "item_id", "[planet]"),
}


# ---------------------------------------------------------------------------
# Endpoint helper
# ---------------------------------------------------------------------------

def assignment_endpoint(war_id) -> str:
    """The assignment endpoint path for a war id (e.g. ``801``)."""
    return f"/api/v2/Assignment/War/{war_id}"


# ---------------------------------------------------------------------------
# Task builder — the capable core
# ---------------------------------------------------------------------------

def build_mo_task(task_type: int, *, planet=None, faction: int = 0,
                  goal: int = 0, item_id=None, unit_id=None,
                  difficulty=None, location_type: int = 1) -> dict:
    """Build one task ``{type, values, valueTypes}``.

    Emits a canonical slot order carrying only the fields meaningful to
    ``task_type`` (plus any optional advanced slot you supply). Because tasks
    are position-independent, the order is for our own readability — the game
    matches by ``valueTypes``.

    Field use by type (see :data:`TASK_FIELDS`):
      * 11 Liberation / 13 Control — ``planet`` (location_index).
      * 3 Eradicate — ``faction`` + ``goal`` (+ optional ``unit_id``).
      * 7 Missions / 9 Operations — ``faction`` + ``goal`` (+ ``difficulty``).
      * 12 Defense — ``faction`` + ``goal``.
      * 2 Extract — ``faction`` + ``goal`` + ``item_id`` (+ optional planet).
      * 15 Expand (tug-of-war) — ``goal``.

    For the seven types the original prototype supported, the output is
    byte-identical to its hand-rolled encoding (proven by the parity test);
    type 2 and the advanced slots are the new capability.
    """
    pairs: list[tuple[int, int]] = []   # (valueType code, value)

    if task_type in (11, 13):                       # Liberation / Control
        pairs += [(VT_GOAL, 1),
                  (VT_LOCATION_TYPE, int(location_type)),
                  (VT_LOCATION_INDEX, int(planet or 0))]
    elif task_type == 15:                           # Expand (tug of war)
        pairs += [(VT_GOAL, int(goal))]
    elif task_type == 2:                            # Extract
        pairs += [(VT_RACE, int(faction)), (VT_GOAL, int(goal))]
        if item_id is not None:
            pairs += [(VT_ITEM_ID, int(item_id))]
        if planet is not None:
            pairs += [(VT_LOCATION_TYPE, int(location_type)),
                      (VT_LOCATION_INDEX, int(planet))]
    elif task_type in (3, 7, 9, 12):  # Eradicate / Missions / Ops / Defense
        # The proven minimal encoding keeps the filler unknown_2=0 slot.
        pairs += [(VT_RACE, int(faction)), (VT_UNKNOWN_2, 0),
                  (VT_GOAL, int(goal))]
        if unit_id is not None:
            pairs += [(VT_UNIT_ID, int(unit_id))]
        if difficulty is not None:
            pairs += [(VT_DIFFICULTY, int(difficulty))]
    else:                                           # unknown type — minimal
        pairs += [(VT_GOAL, int(goal))]

    return {
        "type": int(task_type),
        "values": [v for _, v in pairs],
        "valueTypes": [t for t, _ in pairs],
    }


def decode_task(task: dict) -> dict:
    """Decode a task into ``{type, <field>: value, ...}`` using
    :data:`VALUE_TYPES` — the inverse of :func:`build_mo_task`, used for the
    round-trip test and for any UI that wants to read an existing order."""
    out: dict = {"type": task.get("type")}
    values = task.get("values", []) or []
    vtypes = task.get("valueTypes", []) or []
    for vt, val in zip(vtypes, values):
        out[VALUE_TYPES.get(int(vt), f"vt{vt}")] = val
    return out


def task_issues(task_type: int, *, planet=None, goal=0, item_id=None) -> list:
    """Return a list of human-readable problems with the task's required
    fields (empty list = ready to deploy). Lightweight, front-end agnostic."""
    issues: list[str] = []
    if task_type in (11, 13) and not planet and planet != 0:
        issues.append("needs a target planet")
    if task_type in (2, 3, 7, 9, 12, 15) and int(goal or 0) <= 0:
        issues.append("needs a goal amount > 0")
    if task_type == 2 and item_id is None:
        issues.append("Extract needs an item_id")
    return issues


# ---------------------------------------------------------------------------
# Game-style display helpers (pure) — turn a task into the label + progress
# visualisation the in-game Major Order card shows. Shared by the mo.py
# preview and the eventual in-editor (Qt) card so both read identically.
# ---------------------------------------------------------------------------

# Mission difficulty index → in-game name (1-based ladder).
DIFFICULTY_NAMES = {
    1: "TRIVIAL", 2: "EASY", 3: "MEDIUM", 4: "CHALLENGING", 5: "HARD",
    6: "EXTREME", 7: "SUICIDE MISSION", 8: "IMPOSSIBLE", 9: "HELLDIVE",
    10: "SUPER HELLDIVE",
}


def task_goal(task) -> int:
    """The task's target amount (Liberation/Control encode goal = 1)."""
    try:
        return int(decode_task(task).get("goal") or 0)
    except (TypeError, ValueError):
        return 0


def task_progress_kind(task) -> str:
    """How a front end should draw this task's progress bar:
      * ``"liberation"`` — a planet liberation % bar (types 11 Liberation,
        13 Control/hold);
      * ``"segments"``   — N discrete boxes (type 12 Defense — one per attack);
      * ``"tugofwar"``   — a red|green balance bar (type 15 Expand);
      * ``"count"``      — an "N (X%)" count bar (types 2/3/7/9)."""
    t = task.get("type")
    if t in (11, 13):
        return "liberation"
    if t == 12:
        return "segments"
    if t == 15:
        return "tugofwar"
    return "count"


def task_is_complete(task, progress_value=0) -> bool:
    """True when ``progress_value`` (from the assignment's ``progress[]``)
    meets the task's goal. Liberation/Control treat goal as 1."""
    try:
        p = int(progress_value or 0)
    except (TypeError, ValueError):
        p = 0
    goal = task_goal(task)
    if task.get("type") in (11, 13):
        goal = max(goal, 1)
    return goal > 0 and p >= goal


def _race_title(race) -> str:
    name = FACTIONS.get(int(race or 0)) if race else None
    return name.title() if name else "the enemy"


def _race_plural(race) -> str:
    name = FACTIONS.get(int(race or 0)) if race else None
    return f"THE {name}" if name else "THE ENEMY"


def task_caption_segments(task, planet_names=None, *, unit_names=None,
                          item_names=None) -> list:
    """The in-game task label as a list of ``(text, highlight)`` segments.

    ``highlight`` flags the parts the game tints yellow (planet / faction /
    difficulty / goal / weapon). Join the texts for a flat caption (see
    :func:`task_caption`). ``planet_names`` / ``unit_names`` / ``item_names``
    are optional ``{id: name}`` maps; missing names degrade to ``PLANET n`` /
    ``ITEM n`` rather than failing."""
    planet_names = planet_names or {}
    unit_names = unit_names or {}
    item_names = item_names or {}
    d = decode_task(task)
    t = task.get("type")
    race = d.get("race") or 0
    goal_txt = f"{task_goal(task):,}"

    def planet_seg():
        pi = d.get("location_index")
        name = planet_names.get(pi) if pi is not None else None
        if name:
            return (str(name), True)
        return ((f"PLANET {pi}" if pi is not None else "PLANET"), True)

    def difficulty_segs():
        diff = d.get("difficulty")
        if not diff:
            return []
        name = DIFFICULTY_NAMES.get(int(diff), str(diff))
        return [(" on ", False), (name, True), (" or higher", False)]

    if t == 11:                                       # Liberation
        return [("Liberate ", False), planet_seg()]
    if t == 13:                                       # Control / hold
        return [("Hold ", False), planet_seg(),
                (" when the order expires", False)]
    if t == 12:                                       # Defense
        return [("Defend against ", False), (goal_txt, True),
                (" attacks from ", False), (_race_plural(race), True)]
    if t == 9:                                        # Complete Operations
        return ([("Complete an ", False), ("Operation", True),
                 (" against ", False), (_race_title(race), True)]
                + difficulty_segs()
                + [(" ", False), (goal_txt, True), (" times.", False)])
    if t == 7:                                        # Complete Missions
        return ([("Complete ", False), (goal_txt, True),
                 (" missions against ", False), (_race_title(race), True)]
                + difficulty_segs())
    if t == 3:                                        # Eradicate
        unit = d.get("unit_id")
        target = (unit_names.get(unit) if unit is not None else None)
        if not target:
            name = FACTIONS.get(int(race)) if race else None
            target = name.title() if name else "enemies"
        segs = [("Kill ", False), (goal_txt, True), (" ", False),
                (str(target), True)]
        item = d.get("item_id")
        if item is not None:
            segs += [(" using the ", False),
                     (str(item_names.get(item) or f"ITEM {item}"), True)]
        return segs
    if t == 2:                                        # Extract
        item = d.get("item_id")
        iname = item_names.get(item) if item is not None else None
        segs = [("Extract ", False), (goal_txt, True), (" ", False),
                (str(iname or "samples"), True)]
        if d.get("location_index") is not None:
            segs += [(" from ", False), planet_seg()]
        return segs
    if t == 15:                                       # Expand (tug of war)
        return [("Liberate more planets than are lost during the order "
                 "duration", False)]
    return [(TASK_TYPES.get(t, f"Task {t}"), False)]


def task_caption(task, planet_names=None, **kw) -> str:
    """Flat game-style task label (the joined :func:`task_caption_segments`)."""
    return "".join(text for text, _hl
                   in task_caption_segments(task, planet_names, **kw))


# ---------------------------------------------------------------------------
# Assignment / reward / briefing builders
# ---------------------------------------------------------------------------

def build_reward(amount: int, *, reward_type: int = REWARD_MEDALS,
                 item_id: int = DEFAULT_MEDAL_ITEM_ID) -> dict:
    """One reward entry for ``setting.rewards``."""
    return {"type": int(reward_type), "id32": int(item_id), "amount": int(amount)}


def build_assignment(*, id32: int, start_time: int, expires_in: int,
                     title: str, brief: str, tasks: list, rewards: list,
                     flags: int = 1, task_description: str = "") -> dict:
    """Build one assignment object. ``expiresOn`` is the absolute war-time the
    order ends (``start_time + expires_in``); ``progress`` is sized to the task
    list. ``flags=1`` is the standard 'MAJOR ORDER' banner."""
    tasks = list(tasks)
    return {
        "id32": int(id32),
        "startTime": int(start_time),
        "progress": [0] * max(len(tasks), 1),
        "expiresIn": int(expires_in),
        "expiresOn": int(start_time) + int(expires_in),
        "setting": {
            "type": SETTING_TYPE,
            "overrideTitle": title,
            "overrideBrief": brief,
            "taskDescription": task_description,
            "tasks": tasks,
            "rewards": list(rewards),
            "flags": int(flags),
        },
    }


def build_briefing(*, id32: int, expire_time: int, title: str, message: str,
                   race: int, flag: int = 1, portrait_id: int = 0,
                   title_id: int = 0, message_id: int = 1,
                   intro_media: int = 0, outro_media: int = 0,
                   effect_ids=None, planet_indices=None) -> dict:
    """Build the global-event ('briefing') data block for SaveGlobalEvent.

    ``eventId`` / ``id32`` / ``assignmentId32`` are deliberately the same value
    so the briefing binds to its Major Order; ``expire_time`` should match the
    assignment's ``expiresOn``. The ``message`` supports the game's
    ``<i=1|2|3>...</i>`` faction-colour markup (``<i=3>`` for headers)."""
    return {
        "eventId": int(id32),
        "id32": int(id32),
        "portraitId32": int(portrait_id),
        "title": title,
        "titleId32": int(title_id),
        "message": message,
        "messageId32": int(message_id),
        "race": int(race),
        "flag": int(flag),
        "introMediaId32": int(intro_media),
        "outroMediaId32": int(outro_media),
        "assignmentId32": int(id32),
        "effectIds": list(effect_ids or []),
        "planetIndices": list(planet_indices or []),
        "expireTime": int(expire_time),
    }


# ---------------------------------------------------------------------------
# Deploy payload — the GM /gmcontrols/callfunction batch
# ---------------------------------------------------------------------------

def cmd_deploy_major_orders(endpoint: str, assignments: list,
                            briefing: dict | None = None) -> list:
    """Assemble the GM command batch that deploys a Major Order set.

    Emits one ``OverwriteEndpoint`` carrying the FULL assignment array (it
    replaces the whole endpoint, so every order that should survive must be in
    ``assignments``); when ``briefing`` is supplied, also appends a
    ``SaveGlobalEvent`` carrying the in-game pop-up."""
    payload = [{
        "function": "OverwriteEndpoint",
        "endpoint": endpoint,
        "value": list(assignments),
    }]
    if briefing is not None:
        payload.append({
            "function": "SaveGlobalEvent",
            "eventId": briefing.get("eventId", briefing.get("id32")),
            "data": briefing,
        })
    return payload


# ---------------------------------------------------------------------------
# MajorOrderSession — the framework-agnostic controller (the drop-in brain)
# ---------------------------------------------------------------------------

# Shared editor defaults (UI text), so every front end starts from the same
# place. UI-only concerns (base URL, colours) stay in the view.
DEFAULT_WAR_ID = "801"
DEFAULT_TITLE = "MAJOR ORDER"
DEFAULT_START_TIME = 614500
DEFAULT_DURATION = 259200          # 3 days, in war-seconds
DEFAULT_BRIEF = ("High Command has identified a critical sector. Execute the "
                 "assigned tasks to secure our foothold.")
DEFAULT_MESSAGE = (
    "Super Earth High Command has issued a new directive. All Helldivers are "
    "to deploy at once and see the assigned objectives through to completion. "
    "Managed Democracy depends on it.")
_FIRST_ID = 99901


class MajorOrderSession:
    """Holds an editable Major Order *set* + an optional briefing and turns it
    into the GM deploy payload. Pure: no widgets, no network, no disk — so the
    Tk prototype (``mo.py``) and a future Qt editor tool drive the SAME object
    and only differ in how they render it.

    State:
      * ``orders``      — list of assignment dicts (the OverwriteEndpoint set).
      * ``open_index``  — which order the field/task/reward edits target.
      * ``briefing``    — the SaveGlobalEvent block, or None.
      * ``planet_names``— optional ``{index: name}`` for :meth:`describe_task`.
    The view loads I/O results in via :meth:`load_orders` / :meth:`load_payload`
    and reads the deploy batch out via :meth:`to_payload`.
    """

    def __init__(self, war_id=DEFAULT_WAR_ID):
        self.war_id = str(war_id)
        self.orders: list[dict] = []
        self.open_index: int | None = None
        self.briefing: dict | None = None
        self.planet_names: dict = {}

    # ---- derived ----------------------------------------------------------
    @property
    def endpoint(self) -> str:
        return assignment_endpoint(self.war_id)

    @property
    def current(self) -> dict | None:
        i = self.open_index
        if i is not None and 0 <= i < len(self.orders):
            return self.orders[i]
        return None

    def _alloc_id(self) -> int:
        ids = [o.get("id32", 0) for o in self.orders
               if isinstance(o.get("id32"), int)]
        return (max(ids) + 1) if ids else _FIRST_ID

    # ---- order set --------------------------------------------------------
    def new_order(self, *, start_time=DEFAULT_START_TIME,
                  expires_in=DEFAULT_DURATION, title=DEFAULT_TITLE,
                  brief=DEFAULT_BRIEF) -> dict:
        order = build_assignment(id32=self._alloc_id(), start_time=start_time,
                                 expires_in=expires_in, title=title,
                                 brief=brief, tasks=[], rewards=[])
        self.orders.append(order)
        self.open_index = len(self.orders) - 1
        return order

    def duplicate_order(self) -> dict | None:
        if self.current is None:
            return None
        clone = copy.deepcopy(self.current)
        clone["id32"] = self._alloc_id()
        self.orders.append(clone)
        self.open_index = len(self.orders) - 1
        return clone

    def remove_order(self):
        if self.current is None:
            return
        if len(self.orders) <= 1:
            self.orders = []
            self.open_index = None
        else:
            del self.orders[self.open_index]
            self.open_index = min(self.open_index, len(self.orders) - 1)

    def open(self, index: int):
        if 0 <= index < len(self.orders):
            self.open_index = index

    def ensure_one(self):
        """Guarantee a non-empty set with an open order (call after a remove
        or an empty load so the view always has something to edit)."""
        if not self.orders:
            self.new_order()
        if self.open_index is None:
            self.open_index = 0

    # ---- edit the open order ---------------------------------------------
    def set_general(self, *, id32=None, start_time=None, expires_in=None,
                    title=None, brief=None):
        o = self.current
        if o is None:
            return
        if id32 is not None:
            o["id32"] = int(id32)
        if start_time is not None:
            o["startTime"] = int(start_time)
        if expires_in is not None:
            o["expiresIn"] = int(expires_in)
        if title is not None:
            o["setting"]["overrideTitle"] = title
        if brief is not None:
            o["setting"]["overrideBrief"] = brief
        o["expiresOn"] = int(o.get("startTime", 0)) + int(o.get("expiresIn", 0))

    def open_tasks(self) -> list:
        o = self.current
        return o["setting"]["tasks"] if o else []

    def _resize_progress(self, o):
        n = max(len(o["setting"]["tasks"]), 1)
        if len(o.get("progress", [])) != n:
            o["progress"] = [0] * n

    def add_task(self, task_type, **fields) -> dict | None:
        o = self.current
        if o is None:
            return None
        task = build_mo_task(task_type, **fields)
        o["setting"]["tasks"].append(task)
        self._resize_progress(o)
        return task

    def update_task(self, index, task_type, **fields):
        o = self.current
        if o and 0 <= index < len(o["setting"]["tasks"]):
            o["setting"]["tasks"][index] = build_mo_task(task_type, **fields)

    def remove_task(self, index):
        o = self.current
        if o and 0 <= index < len(o["setting"]["tasks"]):
            del o["setting"]["tasks"][index]
            self._resize_progress(o)

    def clear_tasks(self):
        o = self.current
        if o:
            o["setting"]["tasks"] = []
            self._resize_progress(o)

    def set_reward(self, amount, *, reward_type=REWARD_MEDALS,
                   item_id=DEFAULT_MEDAL_ITEM_ID):
        o = self.current
        if o:
            o["setting"]["rewards"] = [build_reward(
                amount, reward_type=reward_type, item_id=item_id)]

    def clear_reward(self):
        o = self.current
        if o:
            o["setting"]["rewards"] = []

    def open_reward(self) -> dict | None:
        o = self.current
        rewards = o["setting"]["rewards"] if o else []
        return rewards[0] if rewards else None

    # ---- briefing ---------------------------------------------------------
    def order_by_id(self, id32) -> dict | None:
        if id32 is None:
            return None
        for o in self.orders:
            if o.get("id32") == id32:
                return o
        return None

    def set_briefing(self, *, target_id32=None, **fields):
        """(Re)build the briefing bound to ``target_id32`` (or the open order);
        its expire matches that order's expiresOn."""
        target = self.order_by_id(target_id32) or self.current
        if target is None:
            self.briefing = None
            return
        expire = target.get(
            "expiresOn",
            target.get("startTime", 0) + target.get("expiresIn", 0))
        self.briefing = build_briefing(
            id32=target.get("id32", 0), expire_time=expire, **fields)

    def clear_briefing(self):
        self.briefing = None

    # ---- payload in / out -------------------------------------------------
    def to_payload(self) -> list | None:
        if not self.orders:
            return None
        # The briefing's expireTime MUST track its bound order's expiresOn —
        # they're the same war-clock instant (build_briefing's contract). It is
        # snapshotted at set_briefing() time, so any later change to the order's
        # startTime / expiresIn (notably a Sync that pulls the live war clock)
        # would leave the briefing pinned to the stale default start time and
        # the game would treat the global event as already expired. Re-derive it
        # HERE, at payload time, from the bound order's CURRENT expiresOn so the
        # deployed (and previewed) JSON is always consistent. Copy first — never
        # mutate the stored briefing.
        briefing = self.briefing
        if briefing is not None:
            bound = self.order_by_id(
                briefing.get("assignmentId32", briefing.get("id32")))
            if bound is not None:
                briefing = dict(briefing)
                briefing["expireTime"] = int(
                    bound.get("expiresOn",
                              bound.get("startTime", 0)
                              + bound.get("expiresIn", 0)))
        return cmd_deploy_major_orders(self.endpoint, self.orders, briefing)

    def load_orders(self, orders):
        """Replace the set with fetched live assignments (keeps only the
        assignment-shaped dicts)."""
        clean = [o for o in (orders or [])
                 if isinstance(o, dict) and "setting" in o]
        for o in clean:
            o.setdefault("expiresOn",
                         o.get("startTime", 0) + o.get("expiresIn", 0))
        self.orders = clean
        self.open_index = 0 if clean else None
        self.briefing = None

    def load_payload(self, data):
        """Parse a saved payload — this tool's OverwriteEndpoint
        (+ SaveGlobalEvent) batch, a bare assignment array, or a single bare
        assignment — into the set. Raises ValueError if no orders are found."""
        orders, briefing, war_id = [], None, None
        items = data if isinstance(data, list) else [data]
        for cmd in items:
            if not isinstance(cmd, dict):
                continue
            fn = cmd.get("function")
            if fn == "OverwriteEndpoint":
                val = cmd.get("value", cmd.get("data"))
                if isinstance(val, list):
                    orders.extend(o for o in val if isinstance(o, dict))
                elif isinstance(val, dict):
                    orders.append(val)
                tail = str(cmd.get("endpoint", "")).rstrip("/").split("/")[-1]
                if tail.isdigit():
                    war_id = tail
            elif fn == "SaveGlobalEvent":
                if isinstance(cmd.get("data"), dict):
                    briefing = cmd["data"]
            elif "setting" in cmd:
                orders.append(cmd)
        if not orders:
            raise ValueError("no assignments (OverwriteEndpoint) found")
        for o in orders:
            o.setdefault("expiresOn",
                         o.get("startTime", 0) + o.get("expiresIn", 0))
        if war_id:
            self.war_id = war_id
        self.orders = orders
        self.open_index = 0
        self.briefing = briefing

    # ---- display helpers --------------------------------------------------
    def describe_task(self, task) -> str:
        """One-line human label for a task (uses ``planet_names`` when set)."""
        d = decode_task(task)
        label = TASK_TYPES.get(task.get("type"), f"Task {task.get('type')}")
        if "location_index" in d:
            pi = d["location_index"]
            name = self.planet_names.get(pi, "")
            return f"{label} — planet {pi}{' ' + name if name else ''}"
        bits = []
        if "race" in d:
            bits.append(FACTIONS.get(d["race"], "Any faction")
                        if d["race"] else "Any faction")
        if "goal" in d:
            try:
                bits.append(f"goal {int(d['goal']):,}")
            except (TypeError, ValueError):
                bits.append(f"goal {d['goal']}")
        for key, tag in (("item_id", "item"), ("unit_id", "unit"),
                         ("difficulty", "diff")):
            if key in d:
                bits.append(f"{tag} {d[key]}")
        return f"{label} ({', '.join(bits)})" if bits else label

    def order_summary(self, order) -> str:
        """One-line label for an order in the set list."""
        s = order.get("setting", {}) or {}
        title = (s.get("overrideTitle") or "(untitled)").strip()
        ntasks = len(s.get("tasks", []) or [])
        return f"{order.get('id32', '?')} · {title} · {ntasks} task(s)"
