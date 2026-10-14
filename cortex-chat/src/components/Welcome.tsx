import { Orb } from "./Orb";

interface Props {
  name: string;
}

export function Welcome({ name }: Props) {
  return (
    <div className="welcome">
      <Orb />
      <h1 className="welcome__greet">Hello, {name}</h1>
      <p className="welcome__ask">How can I assist you today?</p>
    </div>
  );
}
