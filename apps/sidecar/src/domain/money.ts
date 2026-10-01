import type { FxRate, MicroUsd, MoneyDisplay, Vnd } from '@itstudio/schemas';
import { microUsd, sumMicroUsd, toVnd } from './cost.js';

function grouped(value: bigint, separator: string): string {
  const digits = value.toString();
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);
}

function roundedUnits(value: bigint, unitsPerWhole: bigint, quantum: bigint): bigint {
  return (value + quantum / 2n) / quantum;
}

export function formatUsd(amount: MicroUsd): string {
  const amountBigInt = BigInt(amount);
  if (amountBigInt === 0n) return '$0.00';
  const negative = amountBigInt < 0n;
  const magnitude = negative ? -amountBigInt : amountBigInt;
  let text: string;
  if (magnitude < 1_000_000n) {
    const tenThousandths = roundedUnits(magnitude, 10_000n, 100n);
    const whole = tenThousandths / 10_000n;
    const fraction = (tenThousandths % 10_000n).toString().padStart(4, '0');
    text = `$${whole.toString()}.${fraction}`;
  } else {
    const cents = roundedUnits(magnitude, 100n, 10_000n);
    const whole = cents / 100n;
    const fraction = (cents % 100n).toString().padStart(2, '0');
    text = `$${grouped(whole, ',')}.${fraction}`;
  }
  return negative && magnitude !== 0n ? `-${text}` : text;
}

export function formatVnd(amount: Vnd): string {
  const amountBigInt = BigInt(amount);
  const negative = amountBigInt < 0n;
  const magnitude = negative ? -amountBigInt : amountBigInt;
  return `${negative ? '-' : ''}${grouped(magnitude, '.')} ₫`;
}

export function toMoneyDisplay(amount: MicroUsd, fx: FxRate): MoneyDisplay {
  return {
    microUsd: amount,
    vnd: toVnd(amount, fx),
    usdText: formatUsd(amount),
    vndText: formatVnd(toVnd(amount, fx)),
    fxAsOf: fx.asOf,
  };
}

export { microUsd, sumMicroUsd };
