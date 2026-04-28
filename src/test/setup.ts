import "@testing-library/jest-dom";

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverMock {
    constructor(_callback: ResizeObserverCallback) {}

    observe(_target: Element) {}

    unobserve(_target: Element) {}

    disconnect() {}
  }

  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    writable: true,
    value: ResizeObserverMock,
  });
}
