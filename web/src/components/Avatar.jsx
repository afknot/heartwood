export const initials = name => String(name).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('');

/** A person's photo if you've added one, otherwise their initials. */
export default function Avatar({ person, size = 40, className = '' }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (person?.photo) {
    return <img className={`avatar ${className}`} style={{ ...style, objectFit: 'cover' }} alt="" src={`/api/people/${person.id}/photo?v=${person.photo}`} />;
  }
  return <span className={`avatar ${className}`} style={style}>{initials(person?.name || '?')}</span>;
}
