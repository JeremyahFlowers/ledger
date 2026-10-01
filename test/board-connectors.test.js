// Labels and attached arrows, as geometry (js/board.js).
//
// "If I can't put my thoughts down into the whiteboard what's the point?" A
// design diagram is named boxes joined by arrows, and on the old board a name
// was loose text that stayed behind when its box moved, and an arrow was two
// points that kept pointing at where the box used to be. These pin the pure
// half of the fix: where an attached end goes, what attaches, and what counts
// as clicking a named shape.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  makeElement, edgePoint, centerOf, bindableAt, routeConnector, bindConnector,
  followersOf, containerAt, labelAnchor, hitsElement, CONNECTOR_GAP, movedBy,
} from "../js/board.js";

const box = (id, x, y, w = 100, h = 60, over = {}) =>
  ({ ...makeElement("rect", { id, color: "#fff", points: [{ x, y }, { x: x + w, y: y + h }] }), ...over });
const circle = (id, x, y, w = 100, h = 100) =>
  makeElement("ellipse", { id, color: "#fff", points: [{ x, y }, { x: x + w, y: y + h }] });
const arrow = (id, a, b, over = {}) =>
  ({ ...makeElement("arrow", { id, color: "#fff", points: [a, b] }), ...over });
const close = (p, q, eps = 1e-6) => Math.abs(p.x - q.x) < eps && Math.abs(p.y - q.y) < eps;

describe("where an attached end sits", () => {
  test("test_edgePoint_box_aimedRight_landsOnTheRightEdgePlusTheGap", () => {
    const p = edgePoint(box("a", 0, 0), { x: 500, y: 30 });
    assert.ok(close(p, { x: 100 + CONNECTOR_GAP, y: 30 }), JSON.stringify(p));
  });

  test("test_edgePoint_box_aimedUp_landsOnTheTopEdge", () => {
    const p = edgePoint(box("a", 0, 0), { x: 50, y: -400 });
    assert.ok(close(p, { x: 50, y: -CONNECTOR_GAP }), JSON.stringify(p));
  });

  test("test_edgePoint_circle_landsOnTheCircleNotItsBox", () => {
    // Aimed diagonally, a box's corner is further out than the circle's edge.
    const c = circle("c", 0, 0);
    const p = edgePoint(c, { x: 1000, y: 1000 }, 0);
    const r = Math.hypot(p.x - 50, p.y - 50);
    assert.ok(Math.abs(r - 50) < 1e-6, `radius ${r}`);
  });

  test("test_edgePoint_aimedAtItsOwnCentre_returnsTheCentre", () => {
    assert.ok(close(edgePoint(box("a", 0, 0), { x: 50, y: 30 }), { x: 50, y: 30 }));
  });
});

describe("attaching", () => {
  const elements = [box("a", 0, 0), box("b", 300, 0)];

  test("test_bindableAt_insideABox_findsIt", () => {
    assert.equal(bindableAt(elements, { x: 50, y: 30 }).id, "a");
  });

  test("test_bindableAt_justOutsideTheEdge_stillFindsIt", () => {
    assert.equal(bindableAt(elements, { x: 110, y: 30 }).id, "a");
  });

  test("test_bindableAt_openBoard_findsNothing", () => {
    assert.equal(bindableAt(elements, { x: 200, y: 300 }), null);
  });

  test("test_bindableAt_neverAnotherArrow", () => {
    const withArrow = [...elements, arrow("x", { x: 0, y: 200 }, { x: 400, y: 200 })];
    assert.equal(bindableAt(withArrow, { x: 200, y: 200 }), null);
  });

  test("test_bindConnector_drawnFromBoxToBox_attachesBothEndsAndRoutesEdgeToEdge", () => {
    const a = bindConnector(arrow("x", { x: 50, y: 30 }, { x: 350, y: 30 }), elements);
    assert.deepEqual(a.start, { id: "a" });
    assert.deepEqual(a.end, { id: "b" });
    assert.ok(close(a.points[0], { x: 100 + CONNECTOR_GAP, y: 30 }));
    assert.ok(close(a.points[1], { x: 300 - CONNECTOR_GAP, y: 30 }));
  });

  test("test_bindConnector_oneEndOnOpenBoard_attachesOnlyTheOther", () => {
    const a = bindConnector(arrow("x", { x: 50, y: 30 }, { x: 200, y: 300 }), elements);
    assert.deepEqual(a.start, { id: "a" });
    assert.equal(a.end, undefined);
    assert.deepEqual(a.points[1], { x: 200, y: 300 }, "the free end moved");
  });

  test("test_bindConnector_pulledOffItsBox_comesFree", () => {
    const attached = { ...arrow("x", { x: 50, y: 30 }, { x: 600, y: 600 }), start: { id: "a" } };
    const moved = movedBy(attached, 0, 400);                 // both ends now on open board
    const a = bindConnector(moved, elements);
    assert.equal(a.start, undefined);
  });

  test("test_bindConnector_bothEndsInOneBox_attachesOnce", () => {
    const a = bindConnector(arrow("x", { x: 10, y: 10 }, { x: 90, y: 50 }), elements);
    assert.deepEqual(a.start, { id: "a" });
    assert.equal(a.end, undefined);
  });

  test("test_bindConnector_notAConnector_isUntouched", () => {
    const b = box("z", 0, 0);
    assert.equal(bindConnector(b, elements), b);
  });
});

describe("following a shape", () => {
  test("test_routeConnector_shapeMoved_endFollowsIt", () => {
    const a = box("a", 0, 0);
    const b = box("b", 300, 0);
    const conn = bindConnector(arrow("x", { x: 50, y: 30 }, { x: 350, y: 30 }), [a, b]);
    const bDown = movedBy(b, 0, 300);
    const routed = routeConnector(conn, new Map([[a.id, a], [bDown.id, bDown]]));
    // Now aimed down and to the right, and ending on b's new outline.
    assert.ok(routed.points[1].y > 250, JSON.stringify(routed.points));
  });

  test("test_routeConnector_attachedShapeDeleted_keepsItsPoints", () => {
    const conn = { ...arrow("x", { x: 1, y: 2 }, { x: 3, y: 4 }), start: { id: "gone" } };
    assert.deepEqual(routeConnector(conn, new Map()).points, conn.points);
  });

  test("test_followersOf_returnsOnlyArrowsThatActuallyMoved", () => {
    const a = box("a", 0, 0);
    const b = box("b", 300, 0);
    const c = box("c", 0, 300);
    const ab = bindConnector(arrow("ab", { x: 50, y: 30 }, { x: 350, y: 30 }), [a, b]);
    const bc = bindConnector(arrow("bc", { x: 350, y: 30 }, { x: 50, y: 330 }), [b, c]);
    const aMoved = movedBy(a, -50, 0);
    const out = followersOf([aMoved, b, c, ab, bc], new Set(["a"]));
    assert.deepEqual(out.map((x) => x.id), ["ab"]);
  });

  test("test_followersOf_nothingAttached_isEmpty", () => {
    assert.deepEqual(followersOf([box("a", 0, 0)], new Set(["a"])), []);
  });
});

describe("names", () => {
  test("test_hitsElement_namedBox_isHitInTheMiddle", () => {
    assert.equal(hitsElement(box("a", 0, 0, 200, 100, { label: "Cache" }), { x: 100, y: 50 }), true);
  });

  test("test_hitsElement_unnamedBox_isStillHitOnlyOnItsEdge", () => {
    // An unnamed box is usually a frame round other things.
    assert.equal(hitsElement(box("a", 0, 0, 200, 100), { x: 100, y: 50 }), false);
  });

  test("test_hitsElement_blankName_countsAsUnnamed", () => {
    assert.equal(hitsElement(box("a", 0, 0, 200, 100, { label: "  " }), { x: 100, y: 50 }), false);
  });

  test("test_hitsElement_namedCircle_isHitInside", () => {
    assert.equal(hitsElement({ ...circle("c", 0, 0), label: "DB" }, { x: 50, y: 50 }), true);
  });

  test("test_containerAt_findsTheBoxAPointIsIn", () => {
    assert.equal(containerAt([box("a", 0, 0), box("b", 20, 10, 40, 30)], { x: 30, y: 20 }).id, "b");
    assert.equal(containerAt([box("a", 0, 0)], { x: 500, y: 500 }), null);
  });

  test("test_labelAnchor_shapeIsItsCentre_arrowIsItsMidpoint", () => {
    assert.deepEqual(labelAnchor(box("a", 0, 0)), centerOf(box("a", 0, 0)));
    assert.deepEqual(labelAnchor(arrow("x", { x: 0, y: 0 }, { x: 100, y: 40 })), { x: 50, y: 20 });
  });
});

describe("telling the other device", () => {
  test("test_followersOf_onlyMovedFalse_returnsArrowsAlreadyInPlace", () => {
    const a = box("a", 0, 0);
    const b = box("b", 300, 0);
    const ab = bindConnector(arrow("ab", { x: 50, y: 30 }, { x: 350, y: 30 }), [a, b]);
    assert.deepEqual(followersOf([a, b, ab], new Set(["a"])), [], "nothing moved");
    assert.deepEqual(followersOf([a, b, ab], new Set(["a"]), { onlyMoved: false }).map((x) => x.id), ["ab"]);
  });
});
