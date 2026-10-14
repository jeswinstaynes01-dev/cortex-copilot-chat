interface Props {
  busy?: boolean;
}

/** Purely decorative, so the whole thing is hidden from assistive tech. */
export function Orb({ busy = false }: Props) {
  return (
    <div className={`orb${busy ? " orb--busy" : ""}`} aria-hidden="true">
      <div className="orb__glow" />
      <div className="orb__body" />
      <div className="orb__inner">
        <div className="orb__ring" />
        <div className="orb__ring2" />
        <div className="orb__core" />
        <div className="orb__spec" />
      </div>
    </div>
  );
}
