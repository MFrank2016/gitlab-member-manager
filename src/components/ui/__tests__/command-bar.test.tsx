import { render, screen } from "@testing-library/react";
import { CommandBar, CommandBarSection, CommandBarTitle } from "../command-bar";

it("renders command bar sections", () => {
  render(
    <CommandBar>
      <CommandBarSection>
        <CommandBarTitle>Projects</CommandBarTitle>
      </CommandBarSection>
    </CommandBar>
  );
  expect(screen.getByText("Projects")).toBeInTheDocument();
});