# 讯飞语音评测 A/B 接入

本项目把腾讯智聆保持为主评分，把讯飞开放平台的英语句子朗读评测作为影子评分。影子结果只用于同一条录音的横向比较，不决定孩子是否过关或解锁下一句。

## 配置

在本机或服务器的 `.env` 中配置：

```dotenv
SPEECH_PROVIDER=tencent
SPEECH_SHADOW_PROVIDER=xfyun
SPEECH_SHADOW_TIMEOUT_MS=25000

XFYUN_APP_ID=
XFYUN_API_KEY=
XFYUN_API_SECRET=
```

这些值只能放在后端环境变量里，不能放进前端代码、截图或 Git。将 `SPEECH_SHADOW_PROVIDER` 留空即可关闭云端 A/B 调用。

## 当前实现

- 使用讯飞英文脚本评测 WebSocket：`wss://ise-api.xfyun.cn/v2/open-ise`。
- 类别为 `read_sentence`，引擎为 `en_vip`，开启多维度结果。
- 上传 16 kHz、单声道、16-bit PCM；每 40 ms 发送 1280 字节音频帧。
- 将讯飞 0–100 的总分、准确度、流利度、完整度统一到项目现有量纲。
- 将 `dp_message` 映射为正常、增读、漏读、错读/替换，继续复用现有“漏读总分归零”和严格过关规则。
- 保存逐词、音素、时间位置和服务商异常码，孩子端诊断面板默认折叠。
- 讯飞拒评、超时或调用失败不会影响腾讯主评分。

## 拒评与异常

以下常见讯飞异常会被标记为 `ProviderRejected`，只保留诊断结果：

| 异常码 | 含义 |
| ---: | --- |
| 28673 | 没有有效语音或声音太小 |
| 28676 | 朗读内容与文本无关 |
| 28680 | 信噪比偏低 |
| 28709 | 信噪比严重偏低 |
| 28690 | 音频削波或过载 |

## 校准建议

先积累同一批真实录音的腾讯/讯飞结果，再决定是否调整评分供应商。重点比较漏读、错读、噪音拒评、儿童口音稳定性和接口耗时，不要只比较总分。讯飞控制台为应用提供的免费调用量可能随产品策略变化，正式使用前应以控制台当前配额和计费说明为准。

官方参考：

- [讯飞英语评测 WebSocket API](https://www.xfyun.cn/doc/Ise/IseAPI.html)
- [讯飞语音评测结果协议](https://www.xfyun.cn/doc/voiceservice/ise/ise_protocol.html)
- [讯飞语音评测常见问题](https://www.xfyun.cn/doc/voiceservice/ise/ise_faq.html)
