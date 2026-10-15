import React from 'react';
import { Illustration } from '../../motion/index.js';

/**
 * A centered card for "nothing here yet", "sign in first" and "something went
 * wrong": a heading, a short explanation and one action.
 *
 * `level` keeps the heading order right for where the card sits — 1 when it
 * is the page's only heading, 2 when it sits under the page H1. `as` lets the
 * error screen make the card itself the <main> landmark. `illustration`
 * names a small decorative drawing from the motion layer to show above it.
 */
export default function EmptyState({ title, level = 2, as: Tag = 'div', id, illustration, children, action }) {
  const Heading = `h${level}`;
  return (
    <Tag className="card empty-state" id={id}>
      {illustration && <Illustration name={illustration} />}
      <Heading className="empty-state-title">{title}</Heading>
      {children && <p className="empty-state-text">{children}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </Tag>
  );
}
