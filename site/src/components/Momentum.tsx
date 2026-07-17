import Reveal from "./Reveal";
import { GH, asset } from "@/lib/site";
import styles from "./Momentum.module.css";

export default function Momentum() {
  return (
    <section className={styles.section}>
      <div className={`container ${styles.inner}`}>
        <Reveal className={styles.head}>
          <span className="eyebrow">Momentum</span>
          <h2 className={styles.title}>Found its audience, fast</h2>
          <p className={styles.body}>
            wigolo went public in early July 2026 and most of its GitHub stars
            landed in a single 48-hour window. The chart is the public star
            timeline — flat, then vertical.
          </p>
        </Reveal>

        <Reveal className={styles.chartWrap} delay={120}>
          <picture>
            <source
              media="(prefers-color-scheme: dark)"
              srcSet={asset("/promo/stars-dark.svg")}
            />
            <img
              className={styles.chart}
              src={asset("/promo/stars.svg")}
              alt="wigolo GitHub star growth: flat through mid-July 2026, then a sharp climb over one 48-hour window."
              loading="lazy"
            />
          </picture>
          <p className={styles.caption}>
            Still climbing?{" "}
            <a href={GH} target="_blank" rel="noreferrer">
              Add a ⭐
            </a>{" "}
            — it&apos;s how open source gets found.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
