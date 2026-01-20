import { render, screen } from "@testing-library/react";
import { Sidebar } from "../sidebar";

it("renders collapsed state", () => {
  render(
    <Sidebar
      activeTab="settings"
      onTabChange={() => {}}
      collapsed
      onCollapsedChange={() => {}}
    />
  );
  expect(screen.getByText("GL")).toBeInTheDocument();
});