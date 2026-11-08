import { COMPOUND_META, toPercentages, type Compound, type TyreDistribution } from '../../domain/tyreCall'

/** Compound chip, e.g. "Inters" — colored by compound. */
export function CompoundChip({ compound }: { compound: Compound }) {
  const meta = COMPOUND_META[compound]
  return (
    <span className={`compound-chip ${compound}`} title={meta.hint}>
      <span className="dot" />
      {meta.label}
    </span>
  )
}

/** Confidence line: "Inters 60% · Slicks 40%" — the honest part of the call. */
export function ConfidenceLine({ distribution }: { distribution: TyreDistribution }) {
  const parts = toPercentages(distribution).map((p) => `${COMPOUND_META[p.compound].label} ${p.pct}%`)
  return <span className="tyre-confidence">{parts.join(' · ')}</span>
}
