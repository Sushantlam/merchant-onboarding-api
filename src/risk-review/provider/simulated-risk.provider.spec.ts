import { ConfigService } from '@nestjs/config';
import { RiskProviderUnavailableError } from './risk-provider';
import { SimulatedRiskProvider } from './simulated-risk.provider';

describe('SimulatedRiskProvider', () => {
  const providerWith = (failureRate: number) =>
    new SimulatedRiskProvider(new ConfigService({ riskReview: { failureRate, latencyMs: 0 } }));

  const request = {
    idempotencyKey: 'app-1:1',
    legalBusinessName: 'Example Trading Ltd',
    taxId: '12-3456789',
    merchantCategoryCode: '5812',
    monthlyVolume: 20_000,
    averageTicket: 25,
  };

  it('returns the same result for the same request', async () => {
    const provider = providerWith(0);
    expect(await provider.assess(request)).toEqual(await provider.assess(request));
  });

  it('scores ordinary merchants as low risk', async () => {
    const result = await providerWith(0).assess(request);
    expect(result.level).toBe('LOW');
    expect(result.reasons).toEqual([]);
  });

  it('flags high risk categories and volumes', async () => {
    const result = await providerWith(0).assess({
      ...request,
      merchantCategoryCode: '7995',
      monthlyVolume: 5_000_000,
      averageTicket: 8_000,
    });
    expect(result.level).toBe('HIGH');
    expect(result.reasons).toEqual(['HIGH_RISK_MCC', 'HIGH_MONTHLY_VOLUME', 'HIGH_AVERAGE_TICKET']);
    expect(result.score).toBeLessThanOrEqual(100);
  });

  it('throws a transient error when the provider is unavailable', async () => {
    await expect(providerWith(1).assess(request)).rejects.toBeInstanceOf(
      RiskProviderUnavailableError,
    );
  });
});
