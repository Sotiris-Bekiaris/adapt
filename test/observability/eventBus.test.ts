import { describe, it, expect } from "vitest";
import { EventBus } from "../../src/observability/eventBus.ts";

describe("EventBus", () => {
  it("delivers published events to subscribers", () => {
    const bus = new EventBus<{ n: number }>();
    const got: number[] = [];
    bus.subscribe((e) => got.push(e.n));
    bus.publish({ n: 1 });
    bus.publish({ n: 2 });
    expect(got).toEqual([1, 2]);
  });

  it("unsubscribe stops delivery", () => {
    const bus = new EventBus<number>();
    const got: number[] = [];
    const off = bus.subscribe((e) => got.push(e));
    bus.publish(1);
    off();
    bus.publish(2);
    expect(got).toEqual([1]);
  });

  it("keeps a bounded recent-event buffer for replay", () => {
    const bus = new EventBus<number>({ bufferSize: 2 });
    bus.publish(1); bus.publish(2); bus.publish(3);
    expect(bus.recent()).toEqual([2, 3]);
  });
});
