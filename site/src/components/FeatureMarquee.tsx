import styles from "./FeatureMarquee.module.css";

const ITEMS: { label: string; icons?: string[] }[] = [
  { label: "NO API KEYS" },
  { label: "RUNS ON YOUR MACHINE" },
  { label: "$0 PER QUERY" },
  { label: "18 SEARCH ENGINES" },
  { label: "LOCAL VECTOR CACHE" },
  { label: "OPEN SOURCE · AGPL-3.0" },
];

function Row() {
  return (
    <div className={styles.row} aria-hidden="true">
      {ITEMS.map((it, i) => (
        <span className={styles.item} key={i}>
          <span className={styles.dot}>•</span>
          <span className={styles.label}>{it.label}</span>
          {it.icons && (
            <span className={styles.icons}>
              {it.icons.map((src, j) => (
                <img key={j} src={src} alt="" className={styles.icon} />
              ))}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

export default function FeatureMarquee() {
  return (
    <div className={styles.bar}>
      <div className={styles.track}>
        <Row />
        <Row />
        <Row />
      </div>
    </div>
  );
}
