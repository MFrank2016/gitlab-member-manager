import { render } from "@testing-library/react";
import { Button } from "../button";

it("applies accent focus ring", () => {
  const { getByRole } = render(<Button>Save</Button>);
  expect(getByRole("button").className).toMatch(/ring/);
});