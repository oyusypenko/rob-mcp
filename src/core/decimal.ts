interface ParsedDecimal {
  readonly units: bigint;
  readonly scale: number;
}

const decimalPattern = /^(0|[1-9]\d*)(?:\.(\d+))?$/;

function parseDecimal(value: string): ParsedDecimal {
  const match = decimalPattern.exec(value.trim());
  if (!match) {
    throw new Error(`invalid positive decimal: ${value}`);
  }
  const whole = match[1]!;
  const fractional = match[2] ?? "";
  const units = BigInt(`${whole}${fractional}`);
  if (units <= 0n) {
    throw new Error("decimal value must be positive");
  }
  return { units, scale: fractional.length };
}

function formatDecimal(units: bigint, scale: number): string {
  if (scale === 0) {
    return units.toString();
  }
  const negative = units < 0n;
  const digits = (negative ? -units : units).toString().padStart(scale + 1, "0");
  const whole = digits.slice(0, -scale);
  const fractional = digits.slice(-scale).replace(/0+$/, "");
  const value = fractional ? `${whole}.${fractional}` : whole;
  return negative ? `-${value}` : value;
}

function rescale(value: ParsedDecimal, scale: number): bigint {
  return value.units * 10n ** BigInt(scale - value.scale);
}

export function decimalMidpoint(left: string, right: string): string {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const sum = rescale(a, scale) + rescale(b, scale);
  if (sum % 2n === 0n) {
    return formatDecimal(sum / 2n, scale);
  }
  return formatDecimal(sum * 5n, scale + 1);
}

export function decimalMultiply(left: string, right: string): string {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  return formatDecimal(a.units * b.units, a.scale + b.scale);
}

export function decimalToNumber(value: string): number {
  const parsed = parseDecimal(value);
  const result = Number(parsed.units) / 10 ** parsed.scale;
  if (!Number.isFinite(result) || result <= 0) {
    throw new Error("decimal is outside the supported numeric range");
  }
  return result;
}
