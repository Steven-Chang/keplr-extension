import React, { FunctionComponent } from "react";

import { Dec, DecUtils } from "@keplr/unit";

import { observer } from "mobx-react";
import { useStore } from "../../stores";
import styleAsset from "./asset.module.scss";
import { ToolTip } from "../../../components/tooltip";
import { FormattedMessage, useIntl } from "react-intl";
import { getFiatCurrencyFromLanguage } from "../../../../common/currency";
import { useLanguage } from "../../language";

const LazyDoughnut = React.lazy(async () => {
  const module = await import(
    /* webpackChunkName: "reactChartJS" */ "react-chartjs-2"
  );

  // eslint-disable-next-line @typescript-eslint/ban-ts-ignore
  // @ts-ignore
  const chartJS = module.Chart as any;

  chartJS.pluginService.register({
    beforeDraw: function(chart: any): void {
      const round = {
        x: (chart.chartArea.left + chart.chartArea.right) / 2,
        y: (chart.chartArea.top + chart.chartArea.bottom) / 2,
        radius: (chart.outerRadius + chart.innerRadius) / 2,
        thickness: (chart.outerRadius - chart.innerRadius) / 2
      };

      const ctx = chart.chart.ctx;

      // Draw the background circle.
      ctx.save();
      ctx.beginPath();
      ctx.arc(round.x, round.y, round.radius, 0, 2 * Math.PI);
      ctx.closePath();
      ctx.lineWidth = round.thickness * 2;
      ctx.strokeStyle = "#f4f5f7";
      ctx.stroke();
      ctx.restore();
    },
    beforeTooltipDraw: function(chart: any): void {
      const data = chart.getDatasetMeta(0).data;

      const round = {
        x: (chart.chartArea.left + chart.chartArea.right) / 2,
        y: (chart.chartArea.top + chart.chartArea.bottom) / 2,
        radius: (chart.outerRadius + chart.innerRadius) / 2,
        thickness: (chart.outerRadius - chart.innerRadius) / 2
      };

      const ctx = chart.chart.ctx;

      const drawCircle = (angle: number, color: string) => {
        ctx.save();
        ctx.translate(round.x, round.y);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(
          round.radius * Math.sin(angle),
          round.radius * Math.cos(angle),
          round.thickness,
          0,
          2 * Math.PI
        );
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      };

      const drawCircleEndEachOther = (arc1: any, arc2: any) => {
        const startAngle1 = Math.PI / 2 - arc1._view.startAngle;
        const endAngle1 = Math.PI / 2 - arc1._view.endAngle;

        const startAngle2 = Math.PI / 2 - arc2._view.startAngle;
        // Nomalize
        const endAngle2 = Math.atan2(
          Math.sin(Math.PI / 2 - arc2._view.endAngle),
          Math.cos(Math.PI / 2 - arc2._view.endAngle)
        );

        // If the end of the first arc and the end of the second arc overlap,
        // Don't draw the first arc's end because it overlaps and looks weird.
        if (Math.abs(startAngle1 - endAngle2) > (Math.PI / 180) * 3) {
          drawCircle(startAngle1, arc1._view.backgroundColor);
        }
        if (Math.abs(endAngle1 - startAngle2) > (Math.PI / 180) * 3) {
          drawCircle(endAngle1, arc1._view.backgroundColor);
        }

        if (
          Math.abs(startAngle2) > (Math.PI / 180) * 3 ||
          Math.abs(endAngle2) > (Math.PI / 180) * 3
        ) {
          drawCircle(startAngle2, arc2._view.backgroundColor);
          drawCircle(endAngle2, arc2._view.backgroundColor);
        }
      };

      if (data.length == 2) {
        drawCircleEndEachOther(data[0], data[1]);
      }
    }
  });

  return { default: module.Doughnut };
});

export const AssetStakedChartView: FunctionComponent = observer(() => {
  const { chainStore, accountStoreV2, queriesStore, priceStoreV2 } = useStore();

  const intl = useIntl();

  const language = useLanguage();

  const fiatCurrency = getFiatCurrencyFromLanguage(language.language);

  const current = chainStore.chainInfo;
  const stakeCurrency = current.stakeCurrency;

  const hasCoinGeckoId = stakeCurrency.coinGeckoId != null;

  const queries = queriesStore.get(current.chainId);

  const accountInfo = accountStoreV2.getAccount(current.chainId);

  const balancesQuery = queries
    .getQueryBalances()
    .getQueryBech32Address(accountInfo.bech32Address);

  console.log(current.chainId, accountInfo.bech32Address);

  const stakable = balancesQuery.stakable.balance;

  const delegated = queries
    .getQueryDelegations()
    .getQueryBech32Address(accountInfo.bech32Address)
    .total.upperCase(true);

  const unbonding = queries
    .getQueryUnbondingDelegations()
    .getQueryBech32Address(accountInfo.bech32Address)
    .total.upperCase(true);

  const stakedSum = delegated.add(unbonding);

  const total = stakable.add(stakedSum);

  const stakablePrice = priceStoreV2.calculatePrice(
    stakeCurrency.coinGeckoId || "",
    fiatCurrency.currency,
    stakable
  );
  const stakedSumPrice = priceStoreV2.calculatePrice(
    stakeCurrency.coinGeckoId || "",
    fiatCurrency.currency,
    stakedSum
  );

  const totalPrice = priceStoreV2.calculatePrice(
    stakeCurrency.coinGeckoId || "",
    fiatCurrency.currency,
    total
  );

  // If fiat value is fetched, show the value that is multiplied with amount and fiat value.
  // If not, just show the amount of asset.
  const data: number[] = [
    stakablePrice
      ? parseFloat(stakablePrice.toDec().toString())
      : parseFloat(stakable.toDec().toString()),
    stakedSumPrice
      ? parseFloat(stakedSumPrice.toDec().toString())
      : parseFloat(stakedSum.toString())
  ];

  return (
    <React.Fragment>
      <div className={styleAsset.containerChart}>
        <div className={styleAsset.centerText}>
          <div className={styleAsset.big}>
            <FormattedMessage id="main.account.chart.total-balance" />
          </div>
          <div className={styleAsset.small}>
            {!hasCoinGeckoId
              ? total.toString()
              : totalPrice
              ? totalPrice.toString()
              : total.toString()}
          </div>
          <div className={styleAsset.indicatorIcon}>
            <React.Fragment>
              {balancesQuery.isFetching ? (
                <i className="fas fa-spinner fa-spin" />
              ) : balancesQuery.error ? (
                <ToolTip
                  tooltip={
                    balancesQuery.error?.message ||
                    balancesQuery.error?.statusText
                  }
                  theme="dark"
                  trigger="hover"
                  options={{
                    placement: "top"
                  }}
                >
                  <i className="fas fa-exclamation-triangle text-danger" />
                </ToolTip>
              ) : null}
            </React.Fragment>
          </div>
        </div>
        <React.Suspense fallback={<div style={{ height: "150px" }} />}>
          <LazyDoughnut
            data={{
              datasets: [
                {
                  data,
                  backgroundColor: ["#5e72e4", "#11cdef"],
                  borderWidth: [0, 0]
                }
              ],

              labels: [
                intl.formatMessage({
                  id: "main.account.chart.available-balance"
                }),
                intl.formatMessage({
                  id: "main.account.chart.staked-balance"
                })
              ]
            }}
            options={{
              rotation: 0.5 * Math.PI,
              cutoutPercentage: 85,
              legend: {
                display: false
              },
              tooltips: {
                callbacks: {
                  label: item => {
                    let ratio = new Dec(0);
                    // There are only two labels (stakable, staked (including unbondings)).
                    if (item.index === 0) {
                      if (!total.toDec().equals(new Dec(0))) {
                        ratio = stakable
                          .toDec()
                          .quo(total.toDec())
                          .mul(DecUtils.getPrecisionDec(2));
                      }

                      return `${
                        stakablePrice
                          ? stakablePrice.toString()
                          : stakable.separator("").toString()
                      } (${ratio.toString(1)}%)`;
                    } else if (item.index === 1) {
                      if (!total.toDec().equals(new Dec(0))) {
                        ratio = stakedSum
                          .toDec()
                          .quo(total.toDec())
                          .mul(DecUtils.getPrecisionDec(2));
                      }

                      return `${
                        stakedSumPrice
                          ? stakedSumPrice.toString()
                          : stakedSum.separator("").toString()
                      } (${ratio.toString(1)}%)`;
                    }

                    return "Unexpected error";
                  }
                }
              }
            }}
          />
        </React.Suspense>
      </div>
      <div style={{ marginTop: "12px", width: "100%" }}>
        <div className={styleAsset.legend}>
          <div className={styleAsset.label} style={{ color: "#5e72e4" }}>
            <span className="badge-dot badge badge-secondary">
              <i className="bg-primary" />
            </span>
            <FormattedMessage id="main.account.chart.available-balance" />
          </div>
          <div style={{ minWidth: "16px" }} />
          <div
            className={styleAsset.value}
            style={{
              color: "#525f7f"
            }}
          >
            {stakable.shrink(true).toString()}
          </div>
        </div>
        <div className={styleAsset.legend}>
          <div className={styleAsset.label} style={{ color: "#11cdef" }}>
            <span className="badge-dot badge badge-secondary">
              <i className="bg-info" />
            </span>
            <FormattedMessage id="main.account.chart.staked-balance" />
          </div>
          <div style={{ minWidth: "16px" }} />
          <div
            className={styleAsset.value}
            style={{
              color: "#525f7f"
            }}
          >
            {stakedSum.shrink(true).toString()}
          </div>
        </div>
      </div>
    </React.Fragment>
  );
});

export const AssetView: FunctionComponent = () => {
  return (
    <div className={styleAsset.containerAsset}>
      <AssetStakedChartView />
    </div>
  );
};