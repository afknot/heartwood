import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

// Debriefs, Career, Ask and Settings now live under You. These pages show a way back there.
export const REFLECT_PATHS = /^\/(you|insights|career|ask|settings)(\/|$)/;
export const lastReflect = () => '/you';

export default function ReflectNav() {
  return (
    <div className="hub-nav">
      <Link to="/you" className="btn ghost small" style={{ paddingLeft: 0 }}><Icon name="back" size={16} /> You</Link>
    </div>
  );
}
