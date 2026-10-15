import React from 'react';

/**
 * An explanatory section — heading, paragraphs, illustration, steps and the
 * questions students ask — from server/data/hub-content.json or a major's
 * certification guide. The server writes the same markup into the page's
 * HTML (guideBlock in server/content.js), so a crawler that does not run
 * JavaScript and a person using the app read the same words.
 */
export default function SeoSection({ block, stepsHeading = 'Step by step' }) {
  if (!block) return null;
  const image = block.image?.name ? { src: `/images/${block.image.name}.svg`, alt: block.image.alt } : block.image;
  return (
    <section className="seo-guide section">
      {block.heading && <h2>{block.heading}</h2>}
      {(block.paragraphs || []).map((p) => (
        <p key={p.slice(0, 40)}>{p}</p>
      ))}
      {image?.src && (
        <figure className="page-figure">
          <img src={image.src} alt={image.alt} width="1200" height="630" loading="lazy" decoding="async" />
        </figure>
      )}
      {block.steps?.length > 0 && (
        <>
          {/* Under the section's own h2 this is an h3; with no h2 above it,
              an h2 that looks the same, so the outline never skips a level. */}
          {block.heading ? <h3>{stepsHeading}</h3> : <h2 className="as-h3">{stepsHeading}</h2>}
          <ol className="static-list">
            {block.steps.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ol>
        </>
      )}
      {block.faqs?.length > 0 && (
        <>
          <h2>Questions students ask</h2>
          {block.faqs.map((f) => (
            <div className="faq" key={f.q}>
              <h3>{f.q}</h3>
              <p>{f.a}</p>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
