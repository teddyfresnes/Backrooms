interface Props { colors: string[]; value: string; onChange: (color: string) => void }

export function ColorSwatches({ colors, value, onChange }: Props) {
  return <div className="swatch-row">
    {colors.map((color) => (
      <button
        key={color}
        type="button"
        className={`swatch ${value.toLowerCase() === color.toLowerCase() ? 'active' : ''}`}
        style={{ background: color }}
        title={color}
        aria-label={`Couleur ${color}`}
        onClick={() => onChange(color)}
      />
    ))}
  </div>
}
