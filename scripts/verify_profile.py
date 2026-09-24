"""Check the shared profile and its built pages; no third-party dependencies.

Usage: python3 scripts/verify_profile.py /path/to/hugo-output
"""
import json
import sys
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


class Page(HTMLParser):
    def __init__(self, text):
        super().__init__()
        self.ids = []
        self.tracks = []
        self.links = []
        self.room_data = ""
        self.in_room_data = False
        self.feed(text)

    def handle_starttag(self, tag, attributes):
        attrs = dict(attributes)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if "profile-track" in attrs.get("class", "").split():
            self.tracks.append(attrs.get("id"))
        if tag == "a":
            self.links.append(attrs.get("href", ""))
        if tag == "script" and attrs.get("id") == "room-data":
            self.in_room_data = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.in_room_data = False

    def handle_data(self, data):
        if self.in_room_data:
            self.room_data += data


def main():
    root = Path(__file__).resolve().parents[1]
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else root / "public"
    profile = json.loads((root / "data/profile.json").read_text())
    about = Page((output / "about/index.html").read_text())
    room = Page((output / "index.html").read_text())
    track_ids = [track["id"] for track in profile["tracks"]]
    assert track_ids == ["internships", "research", "open-source"]
    assert about.tracks == track_ids, "Expected three independently rendered timelines"
    assert len(about.ids) == len(set(about.ids)), "Duplicate HTML IDs"
    assert json.loads(room.room_data)["profile"] == profile, "Room profile drifted"
    for track in profile["tracks"]:
        assert track["entries"], f"Empty track: {track['id']}"
        for entry in track["entries"]:
            assert entry["id"] in about.ids, f"Missing entry: {entry['id']}"
            for key in ["date", "title", "role", "status", "summary"]:
                assert entry[key], f"Empty {key} in {entry['id']}"
            for link in entry.get("links", []):
                assert link["url"] in about.links, f"Missing link: {link['url']}"
    journey = profile["journey"]
    assert "journey" in about.ids, "Missing interactive map"
    targets = {entry["id"] for entry in profile["education"]}
    targets.add(profile["project"]["id"])
    targets.update(entry["id"] for track in profile["tracks"] for entry in track["entries"])
    targets.update(track_ids)
    assert [year["label"] for year in journey["years"]] == [
        "大一", "大二", "大三", "大四"
    ]
    for year in journey["years"]:
        assert year["lanes"] >= 1
        for event in year["events"]:
            assert 1 <= event["start"] <= event["end"] <= 12, event
            assert event["caption"].strip(), f"Missing concise event caption: {event['ref']}"
            assert 1 <= event["lane"] <= year["lanes"], event
            if event.get("endAtStart"):
                assert event["start"] < event["end"], event
            event_end = event["end"] if event.get("endAtStart") else event["end"] + 1
            for other in year["events"]:
                if other is event or other["lane"] != event["lane"]:
                    continue
                other_end = other["end"] if other.get("endAtStart") else other["end"] + 1
                assert event_end <= other["start"] or other_end <= event["start"], (
                    f"Overlapping events on one lane: {event['label']} / {other['label']}"
                )
    sophomore, junior, senior = journey["years"][1:]
    assert sophomore["events"][0]["start"] == 1, "Sophomore year should begin in September"
    junior_events = {event["ref"]: event for event in junior["events"] if event["ref"] != "lcc"}
    assert junior_events["ldo"]["start"] == 5, "LDO should begin in January"
    assert junior_events["knight"]["lane"] == junior_events["csg"]["lane"]
    assert junior_events["knight"].get("endAtStart") and junior_events["knight"]["end"] == 11
    assert junior_events["csg"]["start"] == 11
    internships = {entry["id"]: entry for entry in profile["tracks"][0]["entries"]}
    assert internships["knight"]["date"].endswith("2026.06.30")
    assert internships["csg"]["date"] == "2026.07 — 2026.08"
    assert any(event["ref"] == "meta2" and event["start"] == 1 for event in senior["events"])
    events = [event for year in journey["years"] for event in year["events"]]
    events.extend(journey["undated"])
    for event in events:
        assert event["ref"] in targets, f"Unknown map destination: {event['ref']}"
        assert f"#{event['ref']}" in about.links, f"Missing map link: {event['ref']}"
    for link in about.links:
        url = urlsplit(link)
        assert url.scheme in ["", "http", "https", "mailto"], f"Unexpected URL: {link}"
        if not url.scheme and not url.netloc:
            target = output / url.path.lstrip("/") if url.path else output / "about/index.html"
            if target.is_dir():
                target /= "index.html"
            assert target.exists(), f"Missing local target: {link}"
            if url.fragment and target.suffix == ".html":
                assert url.fragment in Page(target.read_text()).ids, f"Missing anchor: {link}"
    print("PASS: shared profile, three timelines, entry metadata, links and local anchors")


if __name__ == "__main__":
    main()
