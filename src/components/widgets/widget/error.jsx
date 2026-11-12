import { useTranslation } from "next-i18next/pages";
import { BiError } from "react-icons/bi";

import Container from "./container";
import PrimaryText from "./primary_text";
import SecondaryText from "./secondary_text";
import WidgetIcon from "./widget_icon";

// S5 数据信封的 error.kind 对应中文原因；未登记的 kind 一律归为「未知」。
const ERROR_REASONS = {
  config_missing: "配置缺失",
  upstream_error: "上游不可达",
  invalid_params: "参数无效",
  auth_required: "需登录",
  disabled: "未启用",
  unknown: "未知",
};

// 「数据截至 X 分钟前」：优先按快照时间 fetchedAt 计算，ageMs 仅在为正且无快照时间时兜底。
// 两者都无效(如 state=error 无快照、fetchedAt=null / ageMs=0)时不虚构新鲜度文案。
function formatAge(envelope) {
  const fetched = Date.parse(envelope?.fetchedAt);
  let minutes;
  if (Number.isFinite(fetched)) {
    minutes = Math.max(1, Math.round((Date.now() - fetched) / 60000));
  } else if (Number.isFinite(envelope?.ageMs) && envelope.ageMs > 0) {
    minutes = Math.max(1, Math.round(envelope.ageMs / 60000));
  } else {
    return "";
  }
  return `数据截至 ${minutes} 分钟前`;
}

export default function Error({ options, envelope }) {
  const { t } = useTranslation();

  // 不传 envelope 时保持与 v1.2.0 完全一致的行为。
  if (!envelope) {
    return (
      <Container options={options} additionalClassNames="information-widget-error">
        <PrimaryText>{t("widget.api_error")}</PrimaryText>
        <WidgetIcon icon={BiError} size="l" />
      </Container>
    );
  }

  const reason = ERROR_REASONS[envelope.error?.kind] || ERROR_REASONS.unknown;
  const ageText = formatAge(envelope);

  return (
    <Container options={options} additionalClassNames="information-widget-error">
      <PrimaryText>{reason}</PrimaryText>
      {ageText && <SecondaryText>{ageText}</SecondaryText>}
      <WidgetIcon icon={BiError} size="l" />
    </Container>
  );
}
