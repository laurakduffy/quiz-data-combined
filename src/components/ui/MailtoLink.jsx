import { useState } from 'react';

// Renders an email address as a link that copies to the clipboard on click
// and flashes "Copied!" in place of the label. Keeps the `mailto:` href so
// middle-click / right-click / modifier-click still work as users expect.
export default function MailtoLink({ email, children, className }) {
  const [copied, setCopied] = useState(false);

  const handleClick = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.button !== 0) return;
    e.preventDefault();
    navigator.clipboard.writeText(email).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <a href={`mailto:${email}`} onClick={handleClick} className={className}>
      {copied ? 'Copied!' : children || email}
    </a>
  );
}
