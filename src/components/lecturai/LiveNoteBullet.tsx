"use client";

import { useEffect, useRef, useState } from "react";
import type { LiveNoteBulletDto } from "@/frontend/types";
import styles from "./LiveLecture.module.css";

// Keeps a stable bullet mounted while briefly marking revisions and new emphasis.
export function LiveNoteBullet({ bullet }: { bullet: LiveNoteBulletDto }) {
  const previousText = useRef(bullet.text);
  const previousEmphasis = useRef(bullet.emphasized);
  const [modified, setModified] = useState(false);
  const [newlyEmphasized, setNewlyEmphasized] = useState(false);

  useEffect(() => {
    if (previousText.current === bullet.text) return;
    previousText.current = bullet.text;
    setModified(true);
    const timeout = setTimeout(() => setModified(false), 650);
    return () => clearTimeout(timeout);
  }, [bullet.text]);

  useEffect(() => {
    if (!previousEmphasis.current && bullet.emphasized) {
      setNewlyEmphasized(true);
      const timeout = setTimeout(() => setNewlyEmphasized(false), 900);
      previousEmphasis.current = bullet.emphasized;
      return () => clearTimeout(timeout);
    }
    previousEmphasis.current = bullet.emphasized;
  }, [bullet.emphasized]);

  return (
    <li
      className={`${styles.noteBullet} ${bullet.emphasized ? styles.noteBulletEmphasized : ""} ${modified ? styles.noteBulletModified : ""} ${newlyEmphasized ? styles.noteBulletEmphasisEntered : ""}`}
    >
      <span>{bullet.kind.toUpperCase()}</span>
      <p>{bullet.text}</p>
      {bullet.emphasized && <small>EMPHASIZED</small>}
    </li>
  );
}
