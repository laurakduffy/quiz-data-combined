import { Target, Building2, Handshake, Scale, BarChart3, HelpCircle } from 'lucide-react';

/**
 * Maps calculation method icon names to Lucide React components.
 * Renders white silhouette icons for result cards.
 */
const ICON_MAP = {
  target: Target,
  parliament: Building2,
  handshake: Handshake,
  scale: Scale,
  'bar-chart': BarChart3,
};

function MethodIcon({ name, size = 18, className = '' }) {
  const IconComponent = ICON_MAP[name] || HelpCircle;

  return <IconComponent size={size} className={className} />;
}

export default MethodIcon;
