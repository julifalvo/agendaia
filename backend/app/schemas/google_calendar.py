from __future__ import annotations

import datetime as dt
import uuid

from pydantic import BaseModel, ConfigDict


class GoogleCalendarStatusOut(BaseModel):
    connected: bool
    calendar_id: str | None = None
    connected_at: dt.datetime | None = None
    last_synced_at: dt.datetime | None = None


class GoogleCalendarConnectOut(BaseModel):
    authorization_url: str


class GoogleCalendarSyncRequest(BaseModel):
    date_from: dt.datetime | None = None
    date_to: dt.datetime | None = None


class GoogleCalendarSyncResultOut(BaseModel):
    connected: bool
    upserted: int
    pruned: int
    error: str | None


class GoogleCalendarBlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    staff_id: uuid.UUID | None
    summary: str | None
    starts_at: dt.datetime
    ends_at: dt.datetime
