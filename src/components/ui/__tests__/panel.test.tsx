import { render, screen } from "@testing-library/react";
import { Panel, PanelHeader, PanelTitle, PanelBody } from "../panel";

it("renders panel structure", () => {
  render(
    <Panel>
      <PanelHeader>
        <PanelTitle>Members</PanelTitle>
      </PanelHeader>
      <PanelBody>Body</PanelBody>
    </Panel>
  );
  expect(screen.getByText("Members")).toBeInTheDocument();
  expect(screen.getByText("Body")).toBeInTheDocument();
});