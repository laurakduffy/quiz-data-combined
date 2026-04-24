import MailtoLink from '../components/ui/MailtoLink';

// Render a string containing at most one markdown link [text](url) as JSX.
// External URLs open in a new tab; mailto: links copy the address to the
// clipboard with a visual confirmation (see MailtoLink).
export function renderMarkdownLink(text) {
  const match = text.match(/^(.*?)\[(.+?)\]\((.+?)\)(.*)$/);
  if (!match) return text;
  const href = match[3];
  if (href.startsWith('mailto:')) {
    return (
      <>
        {match[1]}
        <MailtoLink email={href.slice('mailto:'.length)}>{match[2]}</MailtoLink>
        {match[4]}
      </>
    );
  }
  return (
    <>
      {match[1]}
      <a href={href} target="_blank" rel="noopener noreferrer">
        {match[2]}
      </a>
      {match[4]}
    </>
  );
}
