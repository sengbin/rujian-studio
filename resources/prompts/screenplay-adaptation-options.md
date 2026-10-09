# 任务：分析改编取舍

下面是已确认的创意章节全文。按语速换算，它的预计时长约 {{baselineSeconds}} 秒，而本作品的目标时长是 {{targetSeconds}} 秒，需要把内容压缩到目标时长附近。

{{material}}

## 补充要求

{{extra}}

## 任务

分析哪些内容可以在改编成剧本时取舍，给出候选取舍项供用户勾选确认：

- 取舍项可以是可删减的支线（subplot）、可合并的人物（character_merge）、可跳过的场次（scene_skip），或其他（other）。
- 只分析、不改写正文；每条建议必须对应具体可定位的支线、人物或场次，在 affectedRefs 里写明所在章节、场景或人物名称，每项只写简短名称（如 "第3章"、"灰耳"），不得写 JSON、对象或长句描述；详细说明写在 reason 里。
- estimatedWordsSaved 按该部分在原文中的实际篇幅估算（按汉字数加英文单词数统计），不得夸大或缩小。
- recommended 表示默认建议勾选：尽量让默认勾选后的预计时长落在目标时长附近，但不要求精确。
- 不得建议删除对主线因果链必不可少的内容；这类内容如果确实过多，应如实少给取舍项（可以给空数组），而不是强行凑数。

通过工具提交，参数：{"options": [{"kind": "subplot", "label": "简述", "reason": "取舍理由", "affectedRefs": ["第3章"], "estimatedWordsSaved": 800, "recommended": true}]}
