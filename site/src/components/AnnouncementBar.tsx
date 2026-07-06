"use client";

import { useState } from "react";
import styles from "./AnnouncementBar.module.css";

export default function AnnouncementBar() {
  const [open, setOpen] = useState(true);
  if (!open) return null;
  return (
    <div className={styles.bar}>
      <p className={styles.text}>
        wigolo is in public beta — everything works, and it&apos;s improving fast. Hit a rough edge?{" "}
        <a href="#feedback" className={styles.link}>
          Tell us
        </a>
      </p>
      <button
        className={styles.close}
        aria-label="Dismiss announcement"
        onClick={() => setOpen(false)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path
            d="M4 4l8 8M12 4l-8 8"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
