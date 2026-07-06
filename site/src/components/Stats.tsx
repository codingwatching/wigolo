import Reveal from "./Reveal";
import styles from "./Stats.module.css";

const STATS = [
  { value: "$0", label: "per query, forever" },
  { value: "0", label: "API keys to get started" },
  { value: "10", label: "web tools over one MCP" },
];

export default function Stats() {
  return (
    <section className={styles.section}>
      <div className={`container ${styles.grid}`}>
        {STATS.map((s, i) => (
          <Reveal key={s.value} delay={i * 90} className={styles.cell}>
            <div className={styles.value}>{s.value}</div>
            <div className={styles.label}>{s.label}</div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
