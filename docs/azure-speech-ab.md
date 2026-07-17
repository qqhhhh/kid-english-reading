# Azure Speech 影子 A/B 配置

当前 A/B 设计固定为：腾讯是主评分，Azure 是影子评分。孩子是否通过、能否进入下一句、历史最高分都只由腾讯和本项目的严格评分策略决定。Azure 超时、限流或返回错误只会记录诊断，不会中断练习。

## 1. 创建 Azure Speech 资源

在 Azure Portal 创建 Speech 服务资源，选择支持 Pronunciation Assessment 的区域。记录资源页中的：

- Key（任意一把可用密钥）
- Region，例如 `eastasia`、`southeastasia`；必须使用资源实际区域，不是显示名称

不要把 Key 发到聊天、浏览器或提交到 Git。

官方参考：

- [Pronunciation Assessment 使用说明](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-pronunciation-assessment)
- [Speech 支持区域](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions?tabs=scenarios#regions)
- [支持语言](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=pronunciation-assessment)
- [Speech 定价](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services/)

## 2. 本机配置

在仓库根目录的 `.env` 添加或更新：

```dotenv
SPEECH_PROVIDER=tencent
SPEECH_SHADOW_PROVIDER=azure
SPEECH_SHADOW_TIMEOUT_MS=25000

AZURE_SPEECH_KEY=
AZURE_SPEECH_REGION=
AZURE_SPEECH_LANGUAGE=en-US
AZURE_SPEECH_PHONEME_ALPHABET=IPA
AZURE_SPEECH_NBEST_PHONEME_COUNT=3
AZURE_SPEECH_PROSODY=1
```

修改后只重启目标 API：本地开发使用 4175；正式站通过既定部署流程更新。旧本机 4174 测试服务不再使用。

## 3. 启用检查

访问 `GET /api/health`，预期包含：

```json
{
  "speechProvider": "tencent",
  "speechProviderComparison": {
    "enabled": true,
    "mode": "shadow",
    "primaryProvider": "tencent",
    "shadowProvider": "azure",
    "configured": true
  }
}
```

完成一次有效朗读后，返回的 attempt 和数据库 `attempts.metadata_json` 会包含 `speechProviderComparison`。孩子端评分结果下方会出现默认收起的“评分 A/B 诊断”，其中展示两家总分、准确度、完整度和耗时。Azure 的完整逐词结果也会保存在 shadow result 中。

## 4. 量纲和过关规则

- Azure 的 `AccuracyScore`、`FluencyScore`、`CompletenessScore`、`PronScore` 原始值都是 0–100。
- 内部模型把流利度和完整度转换为 0–1；总分和准确度保留 0–100。
- Azure `Omission`、`Insertion`、`Mispronunciation` 分别映射到本项目的漏读、多读、错读。
- Azure 结果同样经过“漏读总分归零”策略，但只用于横向比较。
- 主评分与影子评分都保存供应商原始总分，避免诊断时混淆供应商分数和策略分数。

## 5. 测试与成本

先收集同一批真实录音，不要根据一两句调整阈值。至少比较：

- 完整朗读、只读半句、漏一个词、错一个词
- 中途中文或无关话后重新完整朗读
- 安静环境、风扇/电视背景音、平板距离变化
- 腾讯/Azure 的漏读标签、逐词分、完整度、总耗时和错误率

`SPEECH_ENHANCEMENT_AB=1` 时，同一次有效尝试还会比较腾讯的原音和降噪音频；再开启 Azure 影子评分后，通常会产生两次腾讯调用和一次 Azure 调用。完成降噪校准后可关闭原音/降噪 A/B，减少成本和等待时间。

关闭 Azure A/B 只需把 `SPEECH_SHADOW_PROVIDER` 留空并重启对应 API，历史比较数据会继续保留。
