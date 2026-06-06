# QQBot BangDream Tsugu 函数与变量用途清单

生成日期：2026-06-06

## 覆盖范围

- 源码目录：`src/qqbot/plugins/bangDream/tsugu`
- TS 文件：92
- 函数节点：481，其中稳定函数 410、匿名/内联回调 71
- 源码 JSDoc：稳定函数 410/410 已覆盖；匿名/内联回调 71 个在本文档中逐条说明，不在源码插入多行 JSDoc，避免 `return` 后 ASI 和表达式语义风险。
- 变量声明：1896
- class/interface/type 字段：716
- 函数参数用途写在函数条目的“参数”列；变量表覆盖 const/let/var、解构绑定、class 字段与类型字段。

## 文件明细

### calculations/cutoff-predictor.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | regression | function | 模块顶层 | data: RegressionInput[] | 推断 | 在数据下载与缓存层中处理regression。 |
| 39 | predict | function | 模块顶层 | cutoff: CutoffPoint[]; startTs: number; endTs: number; rate: number | 推断 | 在数据下载与缓存层中处理预测。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 1 | ep | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 ep 值，供当前逻辑读取或更新。 |
| 1 | time | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 时间 值，供当前逻辑读取或更新。 |
| 3 | ep | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 ep 值，供当前逻辑读取或更新。 |
| 3 | percent | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 percent 值，供当前逻辑读取或更新。 |
| 11 | percentTotal | let | regression | 推断: FirstLiteralToken | 变量，在 regression 中保存 percentTotal 值，供当前逻辑读取或更新。 |
| 12 | epTotal | let | regression | 推断: FirstLiteralToken | 变量，在 regression 中保存 epTotal 值，供当前逻辑读取或更新。 |
| 13 | item | const | regression | 推断 | 变量，在 regression 中保存 道具 值，供当前逻辑读取或更新。 |
| 17 | averagePercent | const | regression | 推断: BinaryExpression | 变量，在 regression 中保存 averagePercent 值，供当前逻辑读取或更新。 |
| 18 | averageEp | const | regression | 推断: BinaryExpression | 变量，在 regression 中保存 averageEp 值，供当前逻辑读取或更新。 |
| 19 | covariance | let | regression | 推断: FirstLiteralToken | 变量，在 regression 中保存 covariance 值，供当前逻辑读取或更新。 |
| 20 | variance | let | regression | 推断: FirstLiteralToken | 变量，在 regression 中保存 variance 值，供当前逻辑读取或更新。 |
| 21 | item | const | regression | 推断 | 变量，在 regression 中保存 道具 值，供当前逻辑读取或更新。 |
| 26 | b | const | regression | 推断: BinaryExpression | 变量，在 regression 中保存 b 值，供当前逻辑读取或更新。 |
| 27 | a | const | regression | 推断: BinaryExpression | 变量，在 regression 中保存 a 值，供当前逻辑读取或更新。 |
| 46 | data | const | predict | RegressionInput[] | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 47 | item | const | predict | 推断 | 变量，在 predict 中保存 道具 值，供当前逻辑读取或更新。 |
| 56 | a | const | predict | 推断: CallExpression | 变量，在 predict 中保存 a 值，供当前逻辑读取或更新。 |
| 56 | b | const | predict | 推断: CallExpression | 变量，在 predict 中保存 b 值，供当前逻辑读取或更新。 |
| 57 | ep | let | predict | 推断: BinaryExpression | 变量，在 predict 中保存 ep 值，供当前逻辑读取或更新。 |

### data-clients/asset-cache-client.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 26 | downloadFile | function | 模块顶层 | url: string; IgnoreErr: boolean; overwrite: 推断; retryCount: 推断 | Promise<Buffer> | 在数据下载与缓存层中下载File。 |
| 74 | <anonymous> | callback | downloadFile | resolve: 推断 | 推断 | 作为 \`new Promise\` 的回调，处理 resolve。 |
| 102 | downloadFileCache | function | 模块顶层 | url: string; IgnoreErr: 推断 | Promise<Buffer> | 在数据下载与缓存层中下载File缓存。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 13 | errUrl | const | 模块顶层 | { [key: string]: number } | 保存 错误对象URL，用于请求接口或下载资源。 |
| 14 | ERROR_CACHE_EXPIRY | const | 模块顶层 | 推断: BinaryExpression | 模块常量，保存 错误对象缓存EXPIRY 配置或静态映射。 |
| 15 | memoryCache | const | 模块顶层 | { [url: string]: Buffer } | 变量，在 模块顶层 中保存 memory缓存 值，供当前逻辑读取或更新。 |
| 33 | currentTime | const | downloadFile | 推断: CallExpression | 变量，在 downloadFile 中保存 当前项时间 值，供当前逻辑读取或更新。 |
| 42 | cacheTime | const | downloadFile | 推断: ConditionalExpression | 变量，在 downloadFile 中保存 缓存时间 值，供当前逻辑读取或更新。 |
| 43 | cacheDir | const | downloadFile | 推断: CallExpression | 变量，在 downloadFile 中保存 缓存目录 值，供当前逻辑读取或更新。 |
| 44 | fileName | const | downloadFile | 推断: CallExpression | 变量，在 downloadFile 中保存 文件名称 值，供当前逻辑读取或更新。 |
| 46 | attempt | let | downloadFile | 推断: FirstLiteralToken | 变量，在 downloadFile 中保存 attempt 值，供当前逻辑读取或更新。 |
| 47 | assetNotExists | let | downloadFile | 推断: FalseKeyword | 变量，在 downloadFile 中保存 资源NotExists 值，供当前逻辑读取或更新。 |
| 55 | data | const | downloadFile | 推断: AwaitExpression | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 56 | htmlSig | const | downloadFile | 推断: CallExpression | 变量，在 downloadFile 中保存 htmlSig 值，供当前逻辑读取或更新。 |
| 57 | slice | const | downloadFile | 推断: CallExpression | 变量，在 downloadFile 中保存 slice 值，供当前逻辑读取或更新。 |
| 66 | e | variable | downloadFile | 推断 | 变量，在 downloadFile 中保存 e 值，供当前逻辑读取或更新。 |
| 77 | e | variable | downloadFile | 推断 | 变量，在 downloadFile 中保存 e 值，供当前逻辑读取或更新。 |
| 109 | data | const | downloadFileCache | 推断: AwaitExpression | 保存当前接口、主数据或模型计算得到的业务数据。 |

### data-clients/file-cache-client.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | download | function | 模块顶层 | url: string; directory: string; fileName: string; cacheTime: 推断 | Promise<Buffer> | 在数据下载与缓存层中下载当前数据。 |
| 86 | ensureDirectoryExists | function | 模块顶层 | filepath: string | 推断 | 在数据下载与缓存层中确保DirectoryExists。 |
| 103 | getJsonAndSave | function | 模块顶层 | url: string; directory: string; fileName: string; cacheTime: 推断 | Promise<object> | 在数据下载与缓存层中获取JSONAndSave。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 5 | errUrl | const | 模块顶层 | string[] | 保存 错误对象URL，用于请求接口或下载资源。 |
| 29 | eTag | let | download | string \| undefined | 变量，在 download 中保存 eTag 值，供当前逻辑读取或更新。 |
| 30 | cacheFilePath | const | download | 推断: CallExpression | 保存 缓存文件路径，用于定位本地文件或资源目录。 |
| 32 | eTagFilePath | const | download | 推断: CallExpression | 保存 eTag文件路径，用于定位本地文件或资源目录。 |
| 37 | stat | const | download | 推断: CallExpression | 变量，在 download 中保存 数值 值，供当前逻辑读取或更新。 |
| 38 | now | const | download | 推断: CallExpression | 变量，在 download 中保存 now 值，供当前逻辑读取或更新。 |
| 40 | cachedData | const | download | 推断: CallExpression | 变量，在 download 中保存 cached数据 值，供当前逻辑读取或更新。 |
| 45 | headers | const | download | 推断: ConditionalExpression | 变量，在 download 中保存 headers 值，供当前逻辑读取或更新。 |
| 46 | response | let | download | 推断 | 变量，在 download 中保存 response 值，供当前逻辑读取或更新。 |
| 49 | error | variable | download | 推断 | 变量，在 download 中保存 错误对象 值，供当前逻辑读取或更新。 |
| 51 | cachedData | const | download | 推断: CallExpression | 变量，在 download 中保存 cached数据 值，供当前逻辑读取或更新。 |
| 58 | fileBuffer | const | download | 推断: CallExpression | 保存 文件缓冲区，用于二进制资源处理。 |
| 60 | newETag | const | download | 推断: PropertyAccessExpression | 变量，在 download 中保存 newETag 值，供当前逻辑读取或更新。 |
| 69 | e | variable | download | 推断 | 变量，在 download 中保存 e 值，供当前逻辑读取或更新。 |
| 113 | eTag | let | getJsonAndSave | string \| undefined | 变量，在 getJsonAndSave 中保存 eTag 值，供当前逻辑读取或更新。 |
| 114 | cacheFilePath | const | getJsonAndSave | 推断: CallExpression | 保存 缓存文件路径，用于定位本地文件或资源目录。 |
| 116 | eTagFilePath | const | getJsonAndSave | 推断: CallExpression | 保存 eTag文件路径，用于定位本地文件或资源目录。 |
| 121 | stat | const | getJsonAndSave | 推断: CallExpression | 变量，在 getJsonAndSave 中保存 数值 值，供当前逻辑读取或更新。 |
| 122 | now | const | getJsonAndSave | 推断: CallExpression | 变量，在 getJsonAndSave 中保存 now 值，供当前逻辑读取或更新。 |
| 124 | cachedData | const | getJsonAndSave | 推断: CallExpression | 变量，在 getJsonAndSave 中保存 cached数据 值，供当前逻辑读取或更新。 |
| 125 | cachedJson | const | getJsonAndSave | 推断: CallExpression | 变量，在 getJsonAndSave 中保存 cachedJson 值，供当前逻辑读取或更新。 |
| 130 | headers | const | getJsonAndSave | 推断: ConditionalExpression | 变量，在 getJsonAndSave 中保存 headers 值，供当前逻辑读取或更新。 |
| 131 | response | let | getJsonAndSave | 推断 | 变量，在 getJsonAndSave 中保存 response 值，供当前逻辑读取或更新。 |
| 134 | error | variable | getJsonAndSave | 推断 | 变量，在 getJsonAndSave 中保存 错误对象 值，供当前逻辑读取或更新。 |
| 136 | cachedData | const | getJsonAndSave | 推断: CallExpression | 变量，在 getJsonAndSave 中保存 cached数据 值，供当前逻辑读取或更新。 |
| 137 | cachedJson | const | getJsonAndSave | 推断: CallExpression | 变量，在 getJsonAndSave 中保存 cachedJson 值，供当前逻辑读取或更新。 |
| 144 | fileBuffer | const | getJsonAndSave | 推断: CallExpression | 保存 文件缓冲区，用于二进制资源处理。 |
| 145 | fileContent | const | getJsonAndSave | 推断: CallExpression | 变量，在 getJsonAndSave 中保存 文件Content 值，供当前逻辑读取或更新。 |
| 146 | jsonObject | const | getJsonAndSave | 推断: CallExpression | 变量，在 getJsonAndSave 中保存 jsonObject 值，供当前逻辑读取或更新。 |
| 148 | newETag | const | getJsonAndSave | 推断: PropertyAccessExpression | 变量，在 getJsonAndSave 中保存 newETag 值，供当前逻辑读取或更新。 |
| 158 | e | variable | getJsonAndSave | 推断 | 变量，在 getJsonAndSave 中保存 e 值，供当前逻辑读取或更新。 |

### data-clients/api-cache-client.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | callAPIAndCacheResponse | function | 模块顶层 | url: string; cacheTime: number; retryCount: number | Promise<object> | 在数据下载与缓存层中调用APIAnd缓存Response。 |
| 50 | <anonymous> | callback | callAPIAndCacheResponse | resolve: 推断 | 推断 | 作为 \`new Promise\` 的回调，处理 resolve。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 27 | cacheDir | const | callAPIAndCacheResponse | 推断: CallExpression | 变量，在 callAPIAndCacheResponse 中保存 缓存目录 值，供当前逻辑读取或更新。 |
| 28 | fileName | const | callAPIAndCacheResponse | 推断: CallExpression | 变量，在 callAPIAndCacheResponse 中保存 文件名称 值，供当前逻辑读取或更新。 |
| 29 | attempt | let | callAPIAndCacheResponse | 推断: FirstLiteralToken | 变量，在 callAPIAndCacheResponse 中保存 attempt 值，供当前逻辑读取或更新。 |
| 31 | data | const | callAPIAndCacheResponse | 推断: AwaitExpression | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 33 | e | variable | callAPIAndCacheResponse | 推断 | 变量，在 callAPIAndCacheResponse 中保存 e 值，供当前逻辑读取或更新。 |

### data-clients/cache-path.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | getCacheDirectory | function | 模块顶层 | url: string | string | 在数据下载与缓存层中获取缓存Directory。 |
| 30 | getFileNameFromUrl | function | 模块顶层 | url: string | string | 在数据下载与缓存层中获取File名称FromURL。 |
| 55 | sanitizeDirectoryName | function | 模块顶层 | dirName: string | string | 在数据下载与缓存层中处理sanitizeDirectory名称。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 11 | urlObj | const | getCacheDirectory | 推断: NewExpression | 变量，在 getCacheDirectory 中保存 URLObj 值，供当前逻辑读取或更新。 |
| 12 | pathname | let | getCacheDirectory | 推断: PropertyAccessExpression | 变量，在 getCacheDirectory 中保存 pathname 值，供当前逻辑读取或更新。 |
| 17 | cacheDir | let | getCacheDirectory | 推断: CallExpression | 变量，在 getCacheDirectory 中保存 缓存目录 值，供当前逻辑读取或更新。 |
| 31 | urlObj | const | getFileNameFromUrl | 推断: NewExpression | 变量，在 getFileNameFromUrl 中保存 URLObj 值，供当前逻辑读取或更新。 |
| 32 | fileName | let | getFileNameFromUrl | 推断: CallExpression | 变量，在 getFileNameFromUrl 中保存 文件名称 值，供当前逻辑读取或更新。 |
| 35 | queryStringIndex | const | getFileNameFromUrl | 推断: CallExpression | 变量，在 getFileNameFromUrl 中保存 queryString下标 值，供当前逻辑读取或更新。 |
| 41 | extension | const | getFileNameFromUrl | 推断: CallExpression | 变量，在 getFileNameFromUrl 中保存 extension 值，供当前逻辑读取或更新。 |
| 56 | illegalChars | const | sanitizeDirectoryName | 推断: RegularExpressionLiteral | 变量，在 sanitizeDirectoryName 中保存 illegalChars 值，供当前逻辑读取或更新。 |
| 57 | replacementChar | const | sanitizeDirectoryName | 推断: StringLiteral | 变量，在 sanitizeDirectoryName 中保存 replacementChar 值，供当前逻辑读取或更新。 |

### models/area-item.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 22 | constructor | constructor | AreaItem | areaItemId: number | - | 构造 AreaItem 实例，并初始化该模型的本地基础字段。 |
| 48 | calcStat | method | AreaItem | card: Card; areaItemLevel: number; cardSTat: Stat; server: Server | Stat | 在 AreaItem 模型中计算数值。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 6 | areaItemId | class-field | AreaItem | number | 保存 区域道具ID，用于定位对应业务实体。 |
| 7 | isExist | class-field | AreaItem | boolean | 布尔标记，表示 isExist 的判断结果。 |
| 8 | level | class-field | AreaItem | Array<number \| null> | 字段，在 AreaItem 中保存 等级 值，供当前逻辑读取或更新。 |
| 9 | areaItemLevel | class-field | AreaItem | number | 字段，在 AreaItem 中保存 区域道具等级 值，供当前逻辑读取或更新。 |
| 10 | areaItemName | class-field | AreaItem | Array<string \| null> | 字段，在 AreaItem 中保存 区域道具名称 值，供当前逻辑读取或更新。 |
| 11 | description | class-field | AreaItem | { [areaItemLevel: number]: Array<string \| null> } | 字段，在 AreaItem 中保存 description 值，供当前逻辑读取或更新。 |
| 12 | performance | class-field | AreaItem | { [areaItemLevel: number]: Array<string \| null> } | 字段，在 AreaItem 中保存 performance 值，供当前逻辑读取或更新。 |
| 13 | technique | class-field | AreaItem | { [areaItemLevel: number]: Array<string \| null> } | 字段，在 AreaItem 中保存 technique 值，供当前逻辑读取或更新。 |
| 14 | visual | class-field | AreaItem | { [areaItemLevel: number]: Array<string \| null> } | 字段，在 AreaItem 中保存 visual 值，供当前逻辑读取或更新。 |
| 15 | targetAttributes | class-field | AreaItem | Array<'cool' \| 'happy' \| 'pure' \| 'powerful'> | 字段，在 AreaItem 中保存 target属性列表 值，供当前逻辑读取或更新。 |
| 16 | targetBandIds | class-field | AreaItem | Array<number> | 保存 target乐队ID 列表，用于定位对应业务实体。 |
| 24 | areaItemData | const | AreaItem | 推断: ElementAccessExpression | 变量，在 AreaItem 中保存 区域道具数据 值，供当前逻辑读取或更新。 |
| 54 | emptyStat | const | calcStat | Stat | 变量，在 calcStat 中保存 empty数值 值，供当前逻辑读取或更新。 |
| 67 | finalStat | const | calcStat | 推断: ObjectLiteralExpression | 变量，在 calcStat 中保存 最终数值 值，供当前逻辑读取或更新。 |

### models/attribute.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | constructor | constructor | Attribute | name: string | - | 构造 Attribute 实例，并初始化该模型的本地基础字段。 |
| 35 | getIcon | method | Attribute | - | Promise<Image> | 在 Attribute 模型中获取图标。 |
| 48 | getAttributeIcon | function | 模块顶层 | attributeName: string | Promise<Image> | 在BangDream 领域模型层中获取属性图标。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 6 | attributeColor | const | 模块顶层 | 推断: ObjectLiteralExpression | 变量，在 模块顶层 中保存 属性颜色 值，供当前逻辑读取或更新。 |
| 14 | name | class-field | Attribute | 'cool' \| 'happy' \| 'pure' \| 'powerful' | 字段，在 Attribute 中保存 名称 值，供当前逻辑读取或更新。 |
| 15 | color | class-field | Attribute | string | 字段，在 Attribute 中保存 颜色 值，供当前逻辑读取或更新。 |
| 40 | attributeIconCache | const | 模块顶层 | { [name: string]: Image } | 变量，在 模块顶层 中保存 属性Icon缓存 值，供当前逻辑读取或更新。 |
| 52 | iconSvgBuffer | const | getAttributeIcon | 推断: AwaitExpression | 保存 iconSvg缓冲区，用于二进制资源处理。 |
| 55 | iconPngBuffer | const | getAttributeIcon | 推断: AwaitExpression | 保存 iconPng缓冲区，用于二进制资源处理。 |
| 56 | image | const | getAttributeIcon | 推断: AwaitExpression | 保存当前加载或绘制的图片对象。 |

### models/band.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | constructor | constructor | Band | bandId: number | - | 构造 Band 实例，并初始化该模型的本地基础字段。 |
| 39 | getMembers | method | Band | - | 推断 | 在 Band 模型中获取Members。 |
| 55 | getIcon | method | Band | - | Promise<Image> | 在 Band 模型中获取图标。 |
| 63 | getLogo | method | Band | - | Promise<Image> | 在 Band 模型中获取Logo。 |
| 79 | getBandIcon | function | 模块顶层 | bandId: number | Promise<Image> | 在BangDream 领域模型层中获取乐队图标。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 10 | bandId | class-field | Band | number | 保存 乐队ID，用于定位对应业务实体。 |
| 11 | isExist | class-field | Band | boolean | 布尔标记，表示 isExist 的判断结果。 |
| 12 | data | class-field | Band | object | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 13 | bandName | class-field | Band | Array<string \| null> | 字段，在 Band 中保存 乐队名称 值，供当前逻辑读取或更新。 |
| 14 | members | class-field | Band | Array<Character \| null> | 字段，在 Band 中保存 members 值，供当前逻辑读取或更新。 |
| 15 | hasIcon | class-field | Band | boolean | 布尔标记，表示 hasIcon 的判断结果。 |
| 23 | bandData | const | Band | 推断: ElementAccessExpression | 变量，在 Band 中保存 乐队数据 值，供当前逻辑读取或更新。 |
| 40 | members | const | getMembers | 推断: ArrayLiteralExpression | 变量，在 getMembers 中保存 members 值，供当前逻辑读取或更新。 |
| 41 | characterList | const | getMembers | 推断: ElementAccessExpression | 保存 角色列表，用于按顺序遍历或批量渲染。 |
| 42 | characterID | const | getMembers | 推断 | 变量，在 getMembers 中保存 角色ID 值，供当前逻辑读取或更新。 |
| 43 | character | const | getMembers | 推断: NewExpression | 保存当前角色领域模型实例。 |
| 64 | logoBuffer | const | getLogo | 推断: AwaitExpression | 保存 logo缓冲区，用于二进制资源处理。 |
| 71 | bandIconCache | const | 模块顶层 | { [bandId: number]: Image } | 变量，在 模块顶层 中保存 乐队Icon缓存 值，供当前逻辑读取或更新。 |
| 83 | iconSvgBuffer | const | getBandIcon | 推断: AwaitExpression | 保存 iconSvg缓冲区，用于二进制资源处理。 |
| 86 | iconPngBuffer | const | getBandIcon | 推断: AwaitExpression | 保存 iconPng缓冲区，用于二进制资源处理。 |
| 87 | image | const | getBandIcon | 推断: AwaitExpression | 保存当前加载或绘制的图片对象。 |

### models/bangdream-constants.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 62 | <anonymous> | callback | BANGDREAM_DEFAULT_SERVER_IDS | serverCode: 推断 | 推断 | 作为 \`BANGDREAM_DEFAULT_SERVER_CODES.map\` 的回调，处理 serverCode。 |
| 75 | <anonymous> | callback | BANGDREAM_SERVER_PRIORITY_IDS | serverCode: 推断 | 推断 | 作为 \`BANGDREAM_SERVER_PRIORITY_CODES.map\` 的回调，处理 serverCode。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 17 | BANGDREAM_SERVER_CODES | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM服务器CODES 配置或静态映射。 |
| 25 | BANGDREAM_SERVER_ID_BY_CODE | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM服务器IDBYCODE 配置或静态映射。 |
| 33 | BANGDREAM_SERVER_LABELS | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM服务器LABELS 配置或静态映射。 |
| 41 | BANGDREAM_SERVER_ALIASES | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM服务器ALIASES 配置或静态映射。 |
| 56 | BANGDREAM_DEFAULT_SERVER_CODES | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAMDEFAULT服务器CODES 配置或静态映射。 |
| 61 | BANGDREAM_DEFAULT_SERVER_IDS | const | 模块顶层 | 推断: CallExpression | 模块常量，保存 BANGDREAMDEFAULT服务器ID 列表 配置或静态映射。 |
| 65 | BANGDREAM_SERVER_PRIORITY_CODES | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM服务器PRIORITYCODES 配置或静态映射。 |
| 73 | BANGDREAM_SERVER_PRIORITY_IDS | const | 模块顶层 | 推断: CallExpression | 模块常量，保存 BANGDREAM服务器PRIORITYID 列表 配置或静态映射。 |
| 86 | BANGDREAM_DIFFICULTY_NAME_BY_ID | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM难度名称BYID 配置或静态映射。 |
| 94 | BANGDREAM_DIFFICULTY_NAMES | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM难度名称列表 配置或静态映射。 |
| 102 | BANGDREAM_DIFFICULTY_COLORS | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM难度颜色列表 配置或静态映射。 |
| 110 | BANGDREAM_DIFFICULTY_ALIASES | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM难度ALIASES 配置或静态映射。 |
| 134 | BANGDREAM_SONG_TAG_NAME | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM歌曲TAG名称 配置或静态映射。 |
| 146 | BANGDREAM_EVENT_STATUS_NAME | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM活动状态名称 配置或静态映射。 |
| 162 | BANGDREAM_EVENT_TYPE_NAME | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM活动类型名称 配置或静态映射。 |
| 179 | BANGDREAM_EVENT_STAGE_TYPES | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM活动试炼类型列表 配置或静态映射。 |
| 185 | BANGDREAM_EVENT_STAGE_STROKE_COLOR | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM活动试炼STROKE颜色 配置或静态映射。 |
| 192 | BANGDREAM_EVENT_STAGE_NAME | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM活动试炼名称 配置或静态映射。 |
| 211 | BANGDREAM_CARD_TYPE_NAME | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM卡牌类型名称 配置或静态映射。 |
| 223 | BANGDREAM_CARD_PRIORITY_TYPES | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM卡牌PRIORITY类型列表 配置或静态映射。 |
| 241 | BANGDREAM_GACHA_TYPE_NAME | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM卡池类型名称 配置或静态映射。 |
| 252 | BANGDREAM_ITEM_TYPE_PREFIXES | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM道具类型PREFIXES 配置或静态映射。 |
| 261 | BANGDREAM_TIER_LIST_BY_SERVER | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAMTIER列表BY服务器 配置或静态映射。 |
| 275 | BANGDREAM_STAGE_CHALLENGE_BAND_ID | const | 模块顶层 | Record<string, number> | 模块常量，保存 BANGDREAM试炼CHALLENGE乐队ID 配置或静态映射。 |
| 285 | BANGDREAM_DECK_TOTAL_RATING_ID | const | 模块顶层 | Record<string, number> | 模块常量，保存 BANGDREAMDECKTOTALRATINGID 配置或静态映射。 |
| 295 | BANGDREAM_STAT_CONFIG | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 BANGDREAM数值配置 配置或静态映射。 |
| 301 | BANGDREAM_CN_ESTIMATE_START_EVENT_ID | const | 模块顶层 | 推断: FirstLiteralToken | 模块常量，保存 BANGDREAMCNESTIMATESTART活动ID 配置或静态映射。 |
| 302 | BANGDREAM_CN_BLOCKED_EVENT_IDS | const | 模块顶层 | readonly number[] | 模块常量，保存 BANGDREAMCNBLOCKED活动ID 列表 配置或静态映射。 |
| 303 | BANGDREAM_DEFAULT_NO_BANG_DAYS | const | 模块顶层 | 推断: FirstLiteralToken | 模块常量，保存 BANGDREAMDEFAULTNOBANGDAYS 配置或静态映射。 |

### models/card.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 38 | addStat | function | 模块顶层 | stat: Stat; add: Stat | void | 在BangDream 领域模型层中追加数值。 |
| 50 | limitBreakRankStat | function | 模块顶层 | rarity: number | 推断 | 在BangDream 领域模型层中处理limitBreakRank数值。 |
| 101 | constructor | constructor | Card | cardId: number | - | 构造 Card 实例，并初始化该模型的本地基础字段。 |
| 130 | initFull | method | Card | useCache: boolean | 推断 | 在 Card 模型中加载远端完整详情并标记初始化状态。 |
| 179 | getData | method | Card | update: boolean | 推断 | 在 Card 模型中请求当前模型的远端详情数据。 |
| 194 | ableToTraining | method | Card | trainingStatus: boolean | boolean | 在 Card 模型中处理ableToTraining。 |
| 214 | getTrainingStatusList | method | Card | - | Array<boolean> | 在 Card 模型中获取Training状态列表。 |
| 288 | calcStat | method | Card | cardData: 推断 | 推断 | 在 Card 模型中计算数值。 |
| 332 | getSkill | method | Card | - | Skill | 在 Card 模型中获取技能。 |
| 341 | isReleased | method | Card | server: Server | boolean | 在 Card 模型中判断Released。 |
| 354 | getFirstReleasedServer | method | Card | displayedServerList: Server[] | Server | 在 Card 模型中获取FirstReleased服务器。 |
| 366 | getRip | method | Card | - | string | 在 Card 模型中获取资源批次。 |
| 383 | getCardIconImage | method | Card | trainingStatus: boolean | Promise<Image> | 在 Card 模型中获取卡牌图标图片。 |
| 398 | getCardIllustrationImage | method | Card | trainingStatus: boolean | Promise<Image> | 在 Card 模型中获取卡牌Illustration图片。 |
| 413 | getCardIllustrationImageBuffer | method | Card | trainingStatus: boolean | Promise<Buffer> | 在 Card 模型中获取卡牌Illustration图片缓冲区。 |
| 430 | getCardTrimImage | method | Card | trainingStatus: boolean | Promise<Image> | 在 Card 模型中获取卡牌Trim图片。 |
| 442 | getTypeName | method | Card | - | 推断 | 在 Card 模型中获取类型名称。 |
| 453 | getMaxLevel | method | Card | - | number | 在 Card 模型中获取Max等级。 |
| 469 | getSource | method | Card | - | 推断 | 在 Card 模型中获取来源。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 25 | performance | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 performance 值，供当前逻辑读取或更新。 |
| 26 | technique | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 technique 值，供当前逻辑读取或更新。 |
| 27 | visual | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 visual 值，供当前逻辑读取或更新。 |
| 30 | typeName | const | 模块顶层 | Record<string, string> | 变量，在 模块顶层 中保存 类型名称 值，供当前逻辑读取或更新。 |
| 52 | tempStat | const | limitBreakRankStat | Stat | 变量，在 limitBreakRankStat 中保存 临时数值 值，供当前逻辑读取或更新。 |
| 61 | cardId | class-field | Card | number | 保存 卡牌ID，用于定位对应业务实体。 |
| 62 | isExist | class-field | Card | boolean | 布尔标记，表示 isExist 的判断结果。 |
| 64 | data | class-field | Card | object | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 65 | characterId | class-field | Card | number | 保存 角色ID，用于定位对应业务实体。 |
| 66 | rarity | class-field | Card | number | 字段，在 Card 中保存 rarity 值，供当前逻辑读取或更新。 |
| 67 | type | class-field | Card | string | 字段，在 Card 中保存 类型 值，供当前逻辑读取或更新。 |
| 68 | attribute | class-field | Card | 'cool' \| 'happy' \| 'pure' \| 'powerful' | 字段，在 Card 中保存 属性 值，供当前逻辑读取或更新。 |
| 69 | levelLimit | class-field | Card | number | 字段，在 Card 中保存 等级Limit 值，供当前逻辑读取或更新。 |
| 70 | resourceSetName | class-field | Card | string | 字段，在 Card 中保存 resource集合名称 值，供当前逻辑读取或更新。 |
| 71 | sdResourceName | class-field | Card | string | 字段，在 Card 中保存 sdResource名称 值，供当前逻辑读取或更新。 |
| 72 | costumeId | class-field | Card | number | 保存 服装ID，用于定位对应业务实体。 |
| 73 | gachaText | class-field | Card | Array<string \| null> | 字段，在 Card 中保存 卡池文本 值，供当前逻辑读取或更新。 |
| 74 | prefix | class-field | Card | Array<string \| null> | 字段，在 Card 中保存 prefix 值，供当前逻辑读取或更新。 |
| 75 | releasedAt | class-field | Card | Array<number \| null> | 字段，在 Card 中保存 releasedAt 值，供当前逻辑读取或更新。 |
| 76 | skillName | class-field | Card | Array<string \| null> | 字段，在 Card 中保存 技能名称 值，供当前逻辑读取或更新。 |
| 77 | source | class-field | Card | Array< \| { [type: string]: { [id: string]: object; }; } \| Record<string, never> > | 字段，在 Card 中保存 来源 值，供当前逻辑读取或更新。 |
| 85 | skillId | class-field | Card | number | 保存 技能ID，用于定位对应业务实体。 |
| 86 | isInitFull | class-field | Card | boolean | 布尔标记，表示 isInitFull 的判断结果。 |
| 87 | stat | class-field | Card | object | 字段，在 Card 中保存 数值 值，供当前逻辑读取或更新。 |
| 88 | bandId | class-field | Card | number | 保存 乐队ID，用于定位对应业务实体。 |
| 91 | skillType | class-field | Card | string | 字段，在 Card 中保存 技能类型 值，供当前逻辑读取或更新。 |
| 92 | scoreUpMaxValue | class-field | Card | number | 字段，在 Card 中保存 分数Up最大值值 值，供当前逻辑读取或更新。 |
| 93 | releaseGacha | class-field | Card | Array<Array<number>> | 字段，在 Card 中保存 发布卡池 值，供当前逻辑读取或更新。 |
| 94 | releaseEvent | class-field | Card | Array<Array<number>> | 字段，在 Card 中保存 发布活动 值，供当前逻辑读取或更新。 |
| 103 | cardData | const | Card | 推断: ElementAccessExpression | 变量，在 Card 中保存 卡牌数据 值，供当前逻辑读取或更新。 |
| 121 | skill | const | Card | 推断: NewExpression | 变量，在 Card 中保存 技能 值，供当前逻辑读取或更新。 |
| 138 | cardData | const | initFull | 推断: AwaitExpression | 变量，在 initFull 中保存 卡牌数据 值，供当前逻辑读取或更新。 |
| 157 | Cnserver | const | initFull | 推断: PropertyAccessExpression | 变量，在 initFull 中保存 Cnserver 值，供当前逻辑读取或更新。 |
| 164 | earlistGacha | const | initFull | 推断: NewExpression | 变量，在 initFull 中保存 earlist卡池 值，供当前逻辑读取或更新。 |
| 180 | time | const | getData | 推断: ConditionalExpression | 变量，在 getData 中保存 时间 值，供当前逻辑读取或更新。 |
| 181 | cardData | const | getData | 推断: AwaitExpression | 变量，在 getData 中保存 卡牌数据 值，供当前逻辑读取或更新。 |
| 216 | trainingStatusList | const | getTrainingStatusList | 推断: ArrayLiteralExpression | 保存 training状态列表，用于按顺序遍历或批量渲染。 |
| 292 | level | const | calcStat | 推断: ConditionalExpression | 变量，在 calcStat 中保存 等级 值，供当前逻辑读取或更新。 |
| 293 | stat | const | calcStat | 推断: ElementAccessExpression | 变量，在 calcStat 中保存 数值 值，供当前逻辑读取或更新。 |
| 296 | userAppend | const | calcStat | 推断: PropertyAccessExpression | 变量，在 calcStat 中保存 userAppend 值，供当前逻辑读取或更新。 |
| 297 | appendStat | const | calcStat | Stat | 变量，在 calcStat 中保存 append数值 值，供当前逻辑读取或更新。 |
| 367 | cardResourceSetId | let | getRip | string | 保存 卡牌Resource集合ID，用于定位对应业务实体。 |
| 370 | cardResourceSetIdNumber | const | getRip | number | 变量，在 getRip 中保存 卡牌Resource集合ID数字 值，供当前逻辑读取或更新。 |
| 385 | trainingString | const | getCardIconImage | 推断: ConditionalExpression | 变量，在 getCardIconImage 中保存 trainingString 值，供当前逻辑读取或更新。 |
| 386 | tempServer | const | getCardIconImage | 推断: CallExpression | 变量，在 getCardIconImage 中保存 临时服务器 值，供当前逻辑读取或更新。 |
| 387 | cardIconImageBuffer | const | getCardIconImage | 推断: AwaitExpression | 保存 卡牌Icon图片缓冲区，用于二进制资源处理。 |
| 400 | trainingString | const | getCardIllustrationImage | 推断: ConditionalExpression | 变量，在 getCardIllustrationImage 中保存 trainingString 值，供当前逻辑读取或更新。 |
| 401 | tempServer | const | getCardIllustrationImage | 推断: CallExpression | 变量，在 getCardIllustrationImage 中保存 临时服务器 值，供当前逻辑读取或更新。 |
| 402 | cardIllustrationImageBuffer | const | getCardIllustrationImage | 推断: AwaitExpression | 保存 卡牌Illustration图片缓冲区，用于二进制资源处理。 |
| 417 | trainingString | const | getCardIllustrationImageBuffer | 推断: ConditionalExpression | 变量，在 getCardIllustrationImageBuffer 中保存 trainingString 值，供当前逻辑读取或更新。 |
| 418 | tempServer | const | getCardIllustrationImageBuffer | 推断: CallExpression | 变量，在 getCardIllustrationImageBuffer 中保存 临时服务器 值，供当前逻辑读取或更新。 |
| 419 | cardIllustration | const | getCardIllustrationImageBuffer | 推断: AwaitExpression | 变量，在 getCardIllustrationImageBuffer 中保存 卡牌Illustration 值，供当前逻辑读取或更新。 |
| 432 | trainingString | const | getCardTrimImage | 推断: ConditionalExpression | 变量，在 getCardTrimImage 中保存 trainingString 值，供当前逻辑读取或更新。 |
| 433 | tempServer | const | getCardTrimImage | 推断: CallExpression | 变量，在 getCardTrimImage 中保存 临时服务器 值，供当前逻辑读取或更新。 |
| 434 | cardIllustrationImageBuffer | const | getCardTrimImage | 推断: AwaitExpression | 保存 卡牌Illustration图片缓冲区，用于二进制资源处理。 |
| 454 | maxLevel | let | getMaxLevel | 推断: FirstLiteralToken | 变量，在 getMaxLevel 中保存 最大值等级 值，供当前逻辑读取或更新。 |
| 455 | i | const | getMaxLevel | 推断 | 保存循环下标或对象键。 |
| 473 | releaseEvent | const | getSource | Array<Array<number>> | 变量，在 getSource 中保存 发布活动 值，供当前逻辑读取或更新。 |
| 474 | releaseGacha | const | getSource | Array<Array<number>> | 变量，在 getSource 中保存 发布卡池 值，供当前逻辑读取或更新。 |
| 475 | k | let | getSource | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 476 | server | const | getSource | 推断: ElementAccessExpression | 保存当前目标服务器枚举或服务器代码。 |
| 477 | sourceOfServer | const | getSource | 推断: ElementAccessExpression | 变量，在 getSource 中保存 来源Of服务器 值，供当前逻辑读取或更新。 |

### models/character.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 43 | constructor | constructor | Character | characterId: number | - | 构造 Character 实例，并初始化该模型的本地基础字段。 |
| 65 | initFull | method | Character | useCache: boolean | 推断 | 在 Character 模型中加载远端完整详情并标记初始化状态。 |
| 100 | getData | method | Character | update: boolean | 推断 | 在 Character 模型中请求当前模型的远端详情数据。 |
| 113 | getIcon | method | Character | - | Promise<Image> | 在 Character 模型中获取图标。 |
| 124 | getIllustration | method | Character | - | Promise<Image> | 在 Character 模型中获取Illustration。 |
| 135 | getNameBanner | method | Character | - | Promise<Image> | 在 Character 模型中获取名称横幅。 |
| 146 | getCharacterName | method | Character | - | Array<string \| null> | 在 Character 模型中获取角色名称。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 9 | characterId | class-field | Character | number | 保存 角色ID，用于定位对应业务实体。 |
| 10 | data | class-field | Character | object | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 11 | characterType | class-field | Character | string | 字段，在 Character 中保存 角色类型 值，供当前逻辑读取或更新。 |
| 12 | characterName | class-field | Character | Array<string \| null> | 字段，在 Character 中保存 角色名称 值，供当前逻辑读取或更新。 |
| 13 | firstName | class-field | Character | Array<string \| null> | 字段，在 Character 中保存 first名称 值，供当前逻辑读取或更新。 |
| 14 | lastName | class-field | Character | Array<string \| null> | 字段，在 Character 中保存 last名称 值，供当前逻辑读取或更新。 |
| 15 | nickname | class-field | Character | Array<string \| null> | 字段，在 Character 中保存 nickname 值，供当前逻辑读取或更新。 |
| 16 | bandId | class-field | Character | number | 保存 乐队ID，用于定位对应业务实体。 |
| 17 | colorCode | class-field | Character | string | 字段，在 Character 中保存 颜色Code 值，供当前逻辑读取或更新。 |
| 18 | sdAssetBundleName | class-field | Character | string | 字段，在 Character 中保存 sd资源Bundle名称 值，供当前逻辑读取或更新。 |
| 19 | defaultCostumeId | class-field | Character | number | 保存 default服装ID，用于定位对应业务实体。 |
| 20 | ruby | class-field | Character | Array<string \| null> | 字段，在 Character 中保存 ruby 值，供当前逻辑读取或更新。 |
| 21 | isExist | class-field | Character | boolean | 布尔标记，表示 isExist 的判断结果。 |
| 22 | profile | class-field | Character | { characterVoice: Array<string \| null>; favoriteFood: Array<string \| null>; hatedFood: Array<string \| null>; hobby: Array<string \| null>; selfIntroduction: Array<string \| null>; school: Array<string \| null>; schoolCls: Array<string \| null>; schoolYear: string[]; part: string; birthday: string; constellation: string; height: number; } | 字段，在 Character 中保存 profile 值，供当前逻辑读取或更新。 |
| 23 | characterVoice | type-field | Character | Array<string \| null> | 字段，在 Character 中保存 角色Voice 值，供当前逻辑读取或更新。 |
| 24 | favoriteFood | type-field | Character | Array<string \| null> | 字段，在 Character 中保存 favoriteFood 值，供当前逻辑读取或更新。 |
| 25 | hatedFood | type-field | Character | Array<string \| null> | 字段，在 Character 中保存 hatedFood 值，供当前逻辑读取或更新。 |
| 26 | hobby | type-field | Character | Array<string \| null> | 字段，在 Character 中保存 hobby 值，供当前逻辑读取或更新。 |
| 27 | selfIntroduction | type-field | Character | Array<string \| null> | 字段，在 Character 中保存 selfIntroduction 值，供当前逻辑读取或更新。 |
| 28 | school | type-field | Character | Array<string \| null> | 字段，在 Character 中保存 school 值，供当前逻辑读取或更新。 |
| 29 | schoolCls | type-field | Character | Array<string \| null> | 字段，在 Character 中保存 schoolCls 值，供当前逻辑读取或更新。 |
| 30 | schoolYear | type-field | Character | string[] | 字段，在 Character 中保存 schoolYear 值，供当前逻辑读取或更新。 |
| 31 | part | type-field | Character | string | 字段，在 Character 中保存 part 值，供当前逻辑读取或更新。 |
| 32 | birthday | type-field | Character | string | 字段，在 Character 中保存 birthday 值，供当前逻辑读取或更新。 |
| 33 | constellation | type-field | Character | string | 字段，在 Character 中保存 constellation 值，供当前逻辑读取或更新。 |
| 34 | height | type-field | Character | number | 保存当前绘制高度。 |
| 36 | isInitFull | class-field | Character | boolean | 布尔标记，表示 isInitFull 的判断结果。 |
| 44 | characterData | const | Character | 推断: ElementAccessExpression | 变量，在 Character 中保存 角色数据 值，供当前逻辑读取或更新。 |
| 73 | characterData | const | initFull | 推断: AwaitExpression | 变量，在 initFull 中保存 角色数据 值，供当前逻辑读取或更新。 |
| 87 | i | let | initFull | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 101 | time | const | getData | 推断: ConditionalExpression | 变量，在 getData 中保存 时间 值，供当前逻辑读取或更新。 |
| 102 | cardData | const | getData | 推断: AwaitExpression | 变量，在 getData 中保存 卡牌数据 值，供当前逻辑读取或更新。 |
| 114 | iconBuffer | const | getIcon | 推断: AwaitExpression | 保存 icon缓冲区，用于二进制资源处理。 |
| 125 | illustrationBuffer | const | getIllustration | 推断: AwaitExpression | 保存 illustration缓冲区，用于二进制资源处理。 |
| 136 | nameBannerBuffer | const | getNameBanner | 推断: AwaitExpression | 保存 名称横幅缓冲区，用于二进制资源处理。 |
| 147 | characterNameList | const | getCharacterName | 推断: ArrayLiteralExpression | 保存 角色名称列表，用于按顺序遍历或批量渲染。 |
| 148 | i | let | getCharacterName | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 149 | element | const | getCharacterName | 推断: ElementAccessExpression | 变量，在 getCharacterName 中保存 element 值，供当前逻辑读取或更新。 |

### models/color.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 14 | constructor | constructor | Color | r: number; g: number; b: number | - | 构造 Color 实例，并初始化该模型的本地基础字段。 |
| 25 | getRGBA | method | Color | alpha: 推断 | string | 在 Color 模型中获取RGBA。 |
| 36 | setRGB | method | Color | r: number; g: number; b: number | 推断 | 在 Color 模型中设置RGB。 |
| 48 | generateColorBlock | method | Color | alpha: 推断 | Canvas | 在 Color 模型中生成颜色块。 |
| 64 | getColorFromHex | function | 模块顶层 | hex: string | Color | 在BangDream 领域模型层中获取颜色FromHex。 |
| 92 | randomRGB | function | 模块顶层 | - | { r: number; g: number; b: number } | 在BangDream 领域模型层中处理randomRGB。 |
| 96 | generateNumber255 | function | randomRGB | - | 推断 | 在BangDream 领域模型层中生成Number255。 |
| 112 | getPresetColor | function | 模块顶层 | index: number | Color | 在BangDream 领域模型层中获取Preset颜色。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 4 | r | class-field | Color | number | 字段，在 Color 中保存 r 值，供当前逻辑读取或更新。 |
| 5 | g | class-field | Color | number | 字段，在 Color 中保存 g 值，供当前逻辑读取或更新。 |
| 6 | b | class-field | Color | number | 字段，在 Color 中保存 b 值，供当前逻辑读取或更新。 |
| 49 | colorCanvas | const | generateColorBlock | 推断: NewExpression | 保存 颜色画布，用于图片绘制或输出。 |
| 50 | colorCtx | const | generateColorBlock | 推断: CallExpression | 变量，在 generateColorBlock 中保存 颜色绘图上下文 值，供当前逻辑读取或更新。 |
| 65 | color | const | getColorFromHex | 推断: NewExpression | 变量，在 getColorFromHex 中保存 颜色 值，供当前逻辑读取或更新。 |
| 74 | presetColorList | const | 模块顶层 | 推断: ArrayLiteralExpression | 保存 preset颜色列表，用于按顺序遍历或批量渲染。 |
| 92 | r | type-field | randomRGB | number | 字段，在 randomRGB 中保存 r 值，供当前逻辑读取或更新。 |
| 92 | g | type-field | randomRGB | number | 字段，在 randomRGB 中保存 g 值，供当前逻辑读取或更新。 |
| 92 | b | type-field | randomRGB | number | 字段，在 randomRGB 中保存 b 值，供当前逻辑读取或更新。 |
| 113 | tempColor | let | getPresetColor | { r: number; g: number; b: number } | 变量，在 getPresetColor 中保存 临时颜色 值，供当前逻辑读取或更新。 |
| 113 | r | type-field | tempColor | number | 字段，在 tempColor 中保存 r 值，供当前逻辑读取或更新。 |
| 113 | g | type-field | tempColor | number | 字段，在 tempColor 中保存 g 值，供当前逻辑读取或更新。 |
| 113 | b | type-field | tempColor | number | 字段，在 tempColor 中保存 b 值，供当前逻辑读取或更新。 |

### models/costume.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 31 | constructor | constructor | Costume | costumeId: number | - | 构造 Costume 实例，并初始化该模型的本地基础字段。 |
| 47 | initFull | method | Costume | - | 推断 | 在 Costume 模型中加载远端完整详情并标记初始化状态。 |
| 70 | getSdCharacter | method | Costume | displayedServerList: Server[] | Promise<Image> | 在 Costume 模型中获取SD角色。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 16 | costumeId | class-field | Costume | number | 保存 服装ID，用于定位对应业务实体。 |
| 17 | isExist | class-field | Costume | boolean | 布尔标记，表示 isExist 的判断结果。 |
| 18 | characterId | class-field | Costume | number | 保存 角色ID，用于定位对应业务实体。 |
| 19 | assetBundleName | class-field | Costume | string | 字段，在 Costume 中保存 资源Bundle名称 值，供当前逻辑读取或更新。 |
| 20 | description | class-field | Costume | Array<string \| null> | 字段，在 Costume 中保存 description 值，供当前逻辑读取或更新。 |
| 21 | publishedAt | class-field | Costume | Array<number \| null> | 字段，在 Costume 中保存 publishedAt 值，供当前逻辑读取或更新。 |
| 22 | data | class-field | Costume | object | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 23 | cards | class-field | Costume | Array<number> | 字段，在 Costume 中保存 卡牌列表 值，供当前逻辑读取或更新。 |
| 24 | sdResourceName | class-field | Costume | string | 字段，在 Costume 中保存 sdResource名称 值，供当前逻辑读取或更新。 |
| 25 | isInitfull | class-field | Costume | boolean | 布尔标记，表示 isInitfull 的判断结果。 |
| 33 | costumeData | const | Costume | 推断: ElementAccessExpression | 变量，在 Costume 中保存 服装数据 值，供当前逻辑读取或更新。 |
| 51 | costumeData | const | initFull | 推断: AwaitExpression | 变量，在 initFull 中保存 服装数据 值，供当前逻辑读取或更新。 |
| 74 | server | const | getSdCharacter | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 75 | sdCharacterBuffer | const | getSdCharacter | 推断: AwaitExpression | 保存 sd角色缓冲区，用于二进制资源处理。 |

### models/cutoff-event-top.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 37 | constructor | constructor | CutoffEventTop | eventId: number; server: Server | - | 构造 CutoffEventTop 实例，并初始化该模型的本地基础字段。 |
| 60 | initFull | method | CutoffEventTop | - | 推断 | 在 CutoffEventTop 模型中加载远端完整详情并标记初始化状态。 |
| 113 | getChartData | method | CutoffEventTop | setStartToZero: 推断 | { [key: number]: { x: Date; y: number }[]; } | 在 CutoffEventTop 模型中获取谱面数据。 |
| 158 | getLatestRanking | method | CutoffEventTop | - | { uid: number; point: number }[] | 在 CutoffEventTop 模型中获取LatestRanking。 |
| 166 | <anonymous> | callback | getLatestRanking | a: 推断; b: 推断 | 推断 | 作为 \`result.sort\` 的回调，处理 a、b。 |
| 175 | getUserByUid | method | CutoffEventTop | id: number | { uid: number; name: string; introduction: string; rank: number; sid: number; strained: number; degrees: number[]; ranking: number; currentPt: number; } | 在 CutoffEventTop 模型中获取UserByUid。 |
| 199 | getUserNameById | method | CutoffEventTop | id: number | string | 在 CutoffEventTop 模型中获取User名称ByID。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 8 | eventId | class-field | CutoffEventTop | number | 保存 活动ID，用于定位对应业务实体。 |
| 9 | server | class-field | CutoffEventTop | Server | 保存当前目标服务器枚举或服务器代码。 |
| 10 | startAt | class-field | CutoffEventTop | number | 字段，在 CutoffEventTop 中保存 startAt 值，供当前逻辑读取或更新。 |
| 11 | endAt | class-field | CutoffEventTop | number | 字段，在 CutoffEventTop 中保存 endAt 值，供当前逻辑读取或更新。 |
| 12 | status | class-field | CutoffEventTop | BangDreamEventStatus | 字段，在 CutoffEventTop 中保存 状态 值，供当前逻辑读取或更新。 |
| 13 | isInitfull | class-field | CutoffEventTop | boolean | 布尔标记，表示 isInitfull 的判断结果。 |
| 14 | isExist | class-field | CutoffEventTop | 推断: FalseKeyword | 布尔标记，表示 isExist 的判断结果。 |
| 15 | points | class-field | CutoffEventTop | { time: number; uid: number; value: number; }[] | 字段，在 CutoffEventTop 中保存 points 值，供当前逻辑读取或更新。 |
| 16 | time | type-field | CutoffEventTop | number | 字段，在 CutoffEventTop 中保存 时间 值，供当前逻辑读取或更新。 |
| 17 | uid | type-field | CutoffEventTop | number | 字段，在 CutoffEventTop 中保存 uid 值，供当前逻辑读取或更新。 |
| 18 | value | type-field | CutoffEventTop | number | 字段，在 CutoffEventTop 中保存 值 值，供当前逻辑读取或更新。 |
| 20 | users | class-field | CutoffEventTop | { uid: number; name: string; introduction: string; rank: number; sid: number; strained: number; degrees: number[]; ranking: number; currentPt: number; }[] | 字段，在 CutoffEventTop 中保存 users 值，供当前逻辑读取或更新。 |
| 21 | uid | type-field | CutoffEventTop | number | 字段，在 CutoffEventTop 中保存 uid 值，供当前逻辑读取或更新。 |
| 22 | name | type-field | CutoffEventTop | string | 字段，在 CutoffEventTop 中保存 名称 值，供当前逻辑读取或更新。 |
| 23 | introduction | type-field | CutoffEventTop | string | 字段，在 CutoffEventTop 中保存 introduction 值，供当前逻辑读取或更新。 |
| 24 | rank | type-field | CutoffEventTop | number | 字段，在 CutoffEventTop 中保存 rank 值，供当前逻辑读取或更新。 |
| 25 | sid | type-field | CutoffEventTop | number | 字段，在 CutoffEventTop 中保存 sid 值，供当前逻辑读取或更新。 |
| 26 | strained | type-field | CutoffEventTop | number | 字段，在 CutoffEventTop 中保存 strained 值，供当前逻辑读取或更新。 |
| 27 | degrees | type-field | CutoffEventTop | number[] | 字段，在 CutoffEventTop 中保存 称号列表 值，供当前逻辑读取或更新。 |
| 28 | ranking | type-field | CutoffEventTop | number | 字段，在 CutoffEventTop 中保存 ranking 值，供当前逻辑读取或更新。 |
| 29 | currentPt | type-field | CutoffEventTop | number | 字段，在 CutoffEventTop 中保存 当前项Pt 值，供当前逻辑读取或更新。 |
| 38 | event | const | CutoffEventTop | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 48 | time | const | CutoffEventTop | 推断: CallExpression | 变量，在 CutoffEventTop 中保存 时间 值，供当前逻辑读取或更新。 |
| 67 | topData | const | initFull | 推断: AwaitExpression | 变量，在 initFull 中保存 top数据 值，供当前逻辑读取或更新。 |
| 76 | time | type-field | initFull | number | 字段，在 initFull 中保存 时间 值，供当前逻辑读取或更新。 |
| 77 | uid | type-field | initFull | number | 字段，在 initFull 中保存 uid 值，供当前逻辑读取或更新。 |
| 78 | value | type-field | initFull | number | 字段，在 initFull 中保存 值 值，供当前逻辑读取或更新。 |
| 81 | uid | type-field | initFull | number | 字段，在 initFull 中保存 uid 值，供当前逻辑读取或更新。 |
| 82 | name | type-field | initFull | string | 字段，在 initFull 中保存 名称 值，供当前逻辑读取或更新。 |
| 83 | introduction | type-field | initFull | string | 字段，在 initFull 中保存 introduction 值，供当前逻辑读取或更新。 |
| 84 | rank | type-field | initFull | number | 字段，在 initFull 中保存 rank 值，供当前逻辑读取或更新。 |
| 85 | sid | type-field | initFull | number | 字段，在 initFull 中保存 sid 值，供当前逻辑读取或更新。 |
| 86 | strained | type-field | initFull | number | 字段，在 initFull 中保存 strained 值，供当前逻辑读取或更新。 |
| 87 | degrees | type-field | initFull | number[] | 字段，在 initFull 中保存 称号列表 值，供当前逻辑读取或更新。 |
| 88 | ranking | type-field | initFull | number | 字段，在 initFull 中保存 ranking 值，供当前逻辑读取或更新。 |
| 89 | currentPt | type-field | initFull | number | 字段，在 initFull 中保存 当前项Pt 值，供当前逻辑读取或更新。 |
| 96 | latestRanking | const | initFull | 推断: CallExpression | 变量，在 initFull 中保存 latestRanking 值，供当前逻辑读取或更新。 |
| 97 | i | let | initFull | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 98 | j | let | initFull | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 114 | x | type-field | getChartData | Date | 保存当前横向绘制坐标。 |
| 114 | y | type-field | getChartData | number | 保存当前纵向绘制坐标。 |
| 119 | chartDate | const | getChartData | { [key: number]: { x: Date; y: number }[] } | 变量，在 getChartData 中保存 谱面Date 值，供当前逻辑读取或更新。 |
| 119 | x | type-field | chartDate | Date | 保存当前横向绘制坐标。 |
| 119 | y | type-field | chartDate | number | 保存当前纵向绘制坐标。 |
| 120 | i | let | getChartData | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 121 | element | const | getChartData | 推断: ElementAccessExpression | 变量，在 getChartData 中保存 element 值，供当前逻辑读取或更新。 |
| 158 | uid | type-field | getLatestRanking | number | 字段，在 getLatestRanking 中保存 uid 值，供当前逻辑读取或更新。 |
| 158 | point | type-field | getLatestRanking | number | 字段，在 getLatestRanking 中保存 point 值，供当前逻辑读取或更新。 |
| 159 | result | const | getLatestRanking | { uid: number; point: number }[] | 保存当前函数最终返回或阶段性处理结果。 |
| 159 | uid | type-field | result | number | 字段，在 result 中保存 uid 值，供当前逻辑读取或更新。 |
| 159 | point | type-field | result | number | 字段，在 result 中保存 point 值，供当前逻辑读取或更新。 |
| 160 | index | let | getLatestRanking | 推断: BinaryExpression | 变量，在 getLatestRanking 中保存 下标 值，供当前逻辑读取或更新。 |
| 162 | element | const | getLatestRanking | 推断: ElementAccessExpression | 变量，在 getLatestRanking 中保存 element 值，供当前逻辑读取或更新。 |
| 176 | uid | type-field | getUserByUid | number | 字段，在 getUserByUid 中保存 uid 值，供当前逻辑读取或更新。 |
| 177 | name | type-field | getUserByUid | string | 字段，在 getUserByUid 中保存 名称 值，供当前逻辑读取或更新。 |
| 178 | introduction | type-field | getUserByUid | string | 字段，在 getUserByUid 中保存 introduction 值，供当前逻辑读取或更新。 |
| 179 | rank | type-field | getUserByUid | number | 字段，在 getUserByUid 中保存 rank 值，供当前逻辑读取或更新。 |
| 180 | sid | type-field | getUserByUid | number | 字段，在 getUserByUid 中保存 sid 值，供当前逻辑读取或更新。 |
| 181 | strained | type-field | getUserByUid | number | 字段，在 getUserByUid 中保存 strained 值，供当前逻辑读取或更新。 |
| 182 | degrees | type-field | getUserByUid | number[] | 字段，在 getUserByUid 中保存 称号列表 值，供当前逻辑读取或更新。 |
| 183 | ranking | type-field | getUserByUid | number | 字段，在 getUserByUid 中保存 ranking 值，供当前逻辑读取或更新。 |
| 184 | currentPt | type-field | getUserByUid | number | 字段，在 getUserByUid 中保存 当前项Pt 值，供当前逻辑读取或更新。 |
| 186 | i | let | getUserByUid | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 200 | i | let | getUserNameById | 推断: FirstLiteralToken | 保存循环下标或对象键。 |

### models/cutoff.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 50 | constructor | constructor | Cutoff | eventId: number; server: Server; tier: number | - | 构造 Cutoff 实例，并初始化该模型的本地基础字段。 |
| 99 | getFinalApiUrl | method | Cutoff | reverse: boolean | 推断 | 在 Cutoff 模型中获取最终APIURL。 |
| 122 | fetchFinalCutoffsData | method | Cutoff | reverse: boolean; cacheTime: number | 推断 | 在 Cutoff 模型中拉取最终档线列表数据。 |
| 134 | reportFinalCutoffsSourceProblem | method | Cutoff | e: 推断 | 推断 | 在 Cutoff 模型中记录最终档线列表来源Problem。 |
| 144 | getFinalCutoffsData | method | Cutoff | forceReadCache: boolean | 推断 | 在 Cutoff 模型中获取最终档线列表数据。 |
| 161 | initFull | method | Cutoff | - | 推断 | 在 Cutoff 模型中加载远端完整详情并标记初始化状态。 |
| 245 | <anonymous> | callback | rateData | element: 推断 | 推断 | 作为 \`rateDataList.find\` 的回调，处理 element。 |
| 270 | predict | method | Cutoff | - | number | 在 Cutoff 模型中处理预测。 |
| 290 | getPredictionWindow | method | Cutoff | - | { startTs: number; endTs: number } | 在 Cutoff 模型中获取预测Window。 |
| 302 | getCutoffsInSeconds | method | Cutoff | - | { time: number; ep: number }[] | 在 Cutoff 模型中获取档线列表InSeconds。 |
| 303 | <anonymous> | callback | getCutoffsInSeconds | element: 推断 | 推断 | 作为 \`this.cutoffs.map\` 的回调，处理 element。 |
| 313 | getPredictionHistory | method | Cutoff | - | { time: number; ep: number }[] | 在 Cutoff 模型中获取预测History。 |
| 338 | getDaysOfEvent | method | Cutoff | ts: number | 推断 | 在 Cutoff 模型中获取DaysOf活动。 |
| 376 | isDailyCheckpoint | method | Cutoff | date: Date | boolean | 在 Cutoff 模型中判断日增Checkpoint。 |
| 390 | getDailyCheckpointSeries | method | Cutoff | - | { score: number[]; time: number[] } | 在 Cutoff 模型中获取日增CheckpointSeries。 |
| 411 | appendMissingHeadScores | method | Cutoff | scoreFinal: number[]; invalidDays: Set<number>; cutoffLastDataDays: number | number | 在 Cutoff 模型中追加MissingHead分数列表。 |
| 439 | appendInterpolatedScores | method | Cutoff | scoreFinal: number[]; invalidDays: Set<number>; startScore: number; endScore: number; lostDays: number | void | 在 Cutoff 模型中追加Interpolated分数列表。 |
| 462 | appendCheckpointScores | method | Cutoff | scoreFinal: number[]; invalidDays: Set<number>; score: number[]; time: number[]; startDayIndex: number | number | 在 Cutoff 模型中追加Checkpoint分数列表。 |
| 503 | appendMissingTailScores | method | Cutoff | scoreFinal: number[]; invalidDays: Set<number>; score: number[]; time: number[]; cutoffLastDataDays: number | void | 在 Cutoff 模型中追加MissingTail分数列表。 |
| 536 | toDailyIncrementList | method | Cutoff | scoreFinal: number[]; invalidDays: Set<number> | string[] | 在 Cutoff 模型中转换为日增增量列表。 |
| 558 | getDailyIncrement | method | Cutoff | - | 推断 | 在 Cutoff 模型中获取日增增量。 |
| 599 | getYesterdayIncrementRate | method | Cutoff | - | 推断 | 在 Cutoff 模型中获取Yesterday增量概率。 |
| 679 | getChartData | method | Cutoff | setStartToZero: 推断 | { x: Date; y: number }[] | 在 Cutoff 模型中获取谱面数据。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 27 | eventId | class-field | Cutoff | number | 保存 活动ID，用于定位对应业务实体。 |
| 28 | server | class-field | Cutoff | Server | 保存当前目标服务器枚举或服务器代码。 |
| 29 | tier | class-field | Cutoff | number | 字段，在 Cutoff 中保存 tier 值，供当前逻辑读取或更新。 |
| 30 | isExist | class-field | Cutoff | 推断: FalseKeyword | 布尔标记，表示 isExist 的判断结果。 |
| 31 | cutoffs | class-field | Cutoff | { time: number; ep: number }[] | 字段，在 Cutoff 中保存 档线列表 值，供当前逻辑读取或更新。 |
| 31 | time | type-field | Cutoff | number | 字段，在 Cutoff 中保存 时间 值，供当前逻辑读取或更新。 |
| 31 | ep | type-field | Cutoff | number | 字段，在 Cutoff 中保存 ep 值，供当前逻辑读取或更新。 |
| 32 | eventType | class-field | Cutoff | string | 字段，在 Cutoff 中保存 活动类型 值，供当前逻辑读取或更新。 |
| 33 | latestCutoff | class-field | Cutoff | { time: number; ep: number } | 字段，在 Cutoff 中保存 latest档线 值，供当前逻辑读取或更新。 |
| 33 | time | type-field | Cutoff | number | 字段，在 Cutoff 中保存 时间 值，供当前逻辑读取或更新。 |
| 33 | ep | type-field | Cutoff | number | 字段，在 Cutoff 中保存 ep 值，供当前逻辑读取或更新。 |
| 34 | rate | class-field | Cutoff | number \| null | 字段，在 Cutoff 中保存 概率 值，供当前逻辑读取或更新。 |
| 35 | predictEP | class-field | Cutoff | number | 字段，在 Cutoff 中保存 predictEP 值，供当前逻辑读取或更新。 |
| 36 | startAt | class-field | Cutoff | number | 字段，在 Cutoff 中保存 startAt 值，供当前逻辑读取或更新。 |
| 37 | endAt | class-field | Cutoff | number | 字段，在 Cutoff 中保存 endAt 值，供当前逻辑读取或更新。 |
| 38 | status | class-field | Cutoff | BangDreamEventStatus | 字段，在 Cutoff 中保存 状态 值，供当前逻辑读取或更新。 |
| 39 | isInitfull | class-field | Cutoff | boolean | 布尔标记，表示 isInitfull 的判断结果。 |
| 40 | useHHWX | class-field | Cutoff | 推断: Identifier | 字段，在 Cutoff 中保存 useHHWX 值，供当前逻辑读取或更新。 |
| 41 | dailyIncrement | class-field | Cutoff | 推断: ArrayLiteralExpression | 字段，在 Cutoff 中保存 日增Increment 值，供当前逻辑读取或更新。 |
| 42 | currentGetDataTime | class-field | Cutoff | 推断 | 字段，在 Cutoff 中保存 当前项Get数据时间 值，供当前逻辑读取或更新。 |
| 51 | event | const | Cutoff | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 82 | tempEvent | const | Cutoff | 推断: NewExpression | 变量，在 Cutoff 中保存 临时活动 值，供当前逻辑读取或更新。 |
| 85 | time | const | Cutoff | 推断: CallExpression | 变量，在 Cutoff 中保存 时间 值，供当前逻辑读取或更新。 |
| 106 | url | const | getFinalApiUrl | 推断: ConditionalExpression | 保存远端接口或资源下载地址。 |
| 145 | cacheTime | const | getFinalCutoffsData | 推断: ConditionalExpression | 变量，在 getFinalCutoffsData 中保存 缓存时间 值，供当前逻辑读取或更新。 |
| 149 | e | variable | getFinalCutoffsData | 推断 | 变量，在 getFinalCutoffsData 中保存 e 值，供当前逻辑读取或更新。 |
| 168 | cutoffData | let | initFull | 推断 | 变量，在 initFull 中保存 档线数据 值，供当前逻辑读取或更新。 |
| 170 | time | const | initFull | 推断: CallExpression | 变量，在 initFull 中保存 时间 值，供当前逻辑读取或更新。 |
| 172 | oldDataSourceFlags | const | initFull | 推断: PropertyAccessExpression | 变量，在 initFull 中保存 old数据来源Flags 值，供当前逻辑读取或更新。 |
| 193 | cutoffData2 | const | initFull | 推断: AwaitExpression | 变量，在 initFull 中保存 档线Data2 值，供当前逻辑读取或更新。 |
| 211 | useCache | const | initFull | 推断: TrueKeyword | 变量，在 initFull 中保存 use缓存 值，供当前逻辑读取或更新。 |
| 233 | time | type-field | initFull | number | 字段，在 initFull 中保存 时间 值，供当前逻辑读取或更新。 |
| 233 | ep | type-field | initFull | number | 字段，在 initFull 中保存 ep 值，供当前逻辑读取或更新。 |
| 235 | event | const | initFull | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 242 | rateDataList | const | initFull | 推断: AsExpression | 保存 概率数据列表，用于按顺序遍历或批量渲染。 |
| 243 | server | type-field | rateDataList | number | 保存当前目标服务器枚举或服务器代码。 |
| 243 | type | type-field | rateDataList | string | 字段，在 rateDataList 中保存 类型 值，供当前逻辑读取或更新。 |
| 243 | tier | type-field | rateDataList | number | 字段，在 rateDataList 中保存 tier 值，供当前逻辑读取或更新。 |
| 243 | rate | type-field | rateDataList | number | 字段，在 rateDataList 中保存 概率 值，供当前逻辑读取或更新。 |
| 245 | rateData | const | initFull | 推断: CallExpression | 变量，在 initFull 中保存 概率数据 值，供当前逻辑读取或更新。 |
| 274 | startTs | const | predict | 推断: CallExpression | 变量，在 predict 中保存 startTs 值，供当前逻辑读取或更新。 |
| 274 | endTs | const | predict | 推断: CallExpression | 变量，在 predict 中保存 endTs 值，供当前逻辑读取或更新。 |
| 275 | cutoffTs | const | predict | 推断: CallExpression | 变量，在 predict 中保存 档线Ts 值，供当前逻辑读取或更新。 |
| 290 | startTs | type-field | getPredictionWindow | number | 字段，在 getPredictionWindow 中保存 startTs 值，供当前逻辑读取或更新。 |
| 290 | endTs | type-field | getPredictionWindow | number | 字段，在 getPredictionWindow 中保存 endTs 值，供当前逻辑读取或更新。 |
| 291 | event | const | getPredictionWindow | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 302 | time | type-field | getCutoffsInSeconds | number | 字段，在 getCutoffsInSeconds 中保存 时间 值，供当前逻辑读取或更新。 |
| 302 | ep | type-field | getCutoffsInSeconds | number | 字段，在 getCutoffsInSeconds 中保存 ep 值，供当前逻辑读取或更新。 |
| 313 | time | type-field | getPredictionHistory | number | 字段，在 getPredictionHistory 中保存 时间 值，供当前逻辑读取或更新。 |
| 313 | ep | type-field | getPredictionHistory | number | 字段，在 getPredictionHistory 中保存 ep 值，供当前逻辑读取或更新。 |
| 317 | startTs | const | getPredictionHistory | 推断: CallExpression | 变量，在 getPredictionHistory 中保存 startTs 值，供当前逻辑读取或更新。 |
| 317 | endTs | const | getPredictionHistory | 推断: CallExpression | 变量，在 getPredictionHistory 中保存 endTs 值，供当前逻辑读取或更新。 |
| 318 | cutoffTs | const | getPredictionHistory | 推断: CallExpression | 变量，在 getPredictionHistory 中保存 档线Ts 值，供当前逻辑读取或更新。 |
| 319 | history | const | getPredictionHistory | { time: number; ep: number }[] | 变量，在 getPredictionHistory 中保存 history 值，供当前逻辑读取或更新。 |
| 319 | time | type-field | history | number | 字段，在 history 中保存 时间 值，供当前逻辑读取或更新。 |
| 319 | ep | type-field | history | number | 字段，在 history 中保存 ep 值，供当前逻辑读取或更新。 |
| 320 | i | let | getPredictionHistory | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 321 | result | let | getPredictionHistory | 推断 | 保存当前函数最终返回或阶段性处理结果。 |
| 340 | offsetMs | const | getDaysOfEvent | 推断: BinaryExpression | 变量，在 getDaysOfEvent 中保存 offsetMs 值，供当前逻辑读取或更新。 |
| 341 | eventStartAtTime | const | getDaysOfEvent | 推断: CallExpression | 变量，在 getDaysOfEvent 中保存 活动StartAt时间 值，供当前逻辑读取或更新。 |
| 342 | timestamp | const | getDaysOfEvent | 推断: CallExpression | 变量，在 getDaysOfEvent 中保存 timestamp 值，供当前逻辑读取或更新。 |
| 344 | serverStartTime | const | getDaysOfEvent | 推断: BinaryExpression | 变量，在 getDaysOfEvent 中保存 服务器Start时间 值，供当前逻辑读取或更新。 |
| 346 | startDate | const | getDaysOfEvent | 推断: NewExpression | 变量，在 getDaysOfEvent 中保存 startDate 值，供当前逻辑读取或更新。 |
| 348 | hour | const | getDaysOfEvent | 推断: CallExpression | 变量，在 getDaysOfEvent 中保存 hour 值，供当前逻辑读取或更新。 |
| 349 | minute | const | getDaysOfEvent | 推断: CallExpression | 变量，在 getDaysOfEvent 中保存 minute 值，供当前逻辑读取或更新。 |
| 350 | second | const | getDaysOfEvent | 推断: CallExpression | 变量，在 getDaysOfEvent 中保存 second 值，供当前逻辑读取或更新。 |
| 351 | millisecond | const | getDaysOfEvent | 推断: CallExpression | 变量，在 getDaysOfEvent 中保存 millisecond 值，供当前逻辑读取或更新。 |
| 353 | firstDayEndServerTime | const | getDaysOfEvent | 推断: BinaryExpression | 变量，在 getDaysOfEvent 中保存 firstDayEnd服务器时间 值，供当前逻辑读取或更新。 |
| 362 | firstDayEndTime | const | getDaysOfEvent | 推断: BinaryExpression | 变量，在 getDaysOfEvent 中保存 firstDayEnd时间 值，供当前逻辑读取或更新。 |
| 390 | score | type-field | getDailyCheckpointSeries | number[] | 字段，在 getDailyCheckpointSeries 中保存 分数 值，供当前逻辑读取或更新。 |
| 390 | time | type-field | getDailyCheckpointSeries | number[] | 字段，在 getDailyCheckpointSeries 中保存 时间 值，供当前逻辑读取或更新。 |
| 391 | score | const | getDailyCheckpointSeries | number[] | 变量，在 getDailyCheckpointSeries 中保存 分数 值，供当前逻辑读取或更新。 |
| 392 | time | const | getDailyCheckpointSeries | number[] | 变量，在 getDailyCheckpointSeries 中保存 时间 值，供当前逻辑读取或更新。 |
| 393 | c | const | getDailyCheckpointSeries | 推断 | 变量，在 getDailyCheckpointSeries 中保存 c 值，供当前逻辑读取或更新。 |
| 394 | timestamp | const | getDailyCheckpointSeries | 推断: CallExpression | 变量，在 getDailyCheckpointSeries 中保存 timestamp 值，供当前逻辑读取或更新。 |
| 395 | date | const | getDailyCheckpointSeries | 推断: CallExpression | 变量，在 getDailyCheckpointSeries 中保存 date 值，供当前逻辑读取或更新。 |
| 416 | lastCutoff | const | appendMissingHeadScores | 推断: ElementAccessExpression | 变量，在 appendMissingHeadScores 中保存 last档线 值，供当前逻辑读取或更新。 |
| 417 | j | let | appendMissingHeadScores | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 418 | i | let | appendMissingHeadScores | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 423 | avgIncrementValue | const | appendMissingHeadScores | 推断: CallExpression | 变量，在 appendMissingHeadScores 中保存 avgIncrement值 值，供当前逻辑读取或更新。 |
| 446 | avgIncrementValue | const | appendInterpolatedScores | 推断: CallExpression | 变量，在 appendInterpolatedScores 中保存 avgIncrement值 值，供当前逻辑读取或更新。 |
| 447 | ld | let | appendInterpolatedScores | 推断: FirstLiteralToken | 变量，在 appendInterpolatedScores 中保存 ld 值，供当前逻辑读取或更新。 |
| 469 | j | let | appendCheckpointScores | 推断: Identifier | 保存嵌套循环下标或对象键。 |
| 471 | i | let | appendCheckpointScores | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 472 | dayOfEvent | const | appendCheckpointScores | 推断: CallExpression | 变量，在 appendCheckpointScores 中保存 dayOf活动 值，供当前逻辑读取或更新。 |
| 482 | lostDays | const | appendCheckpointScores | 推断: BinaryExpression | 变量，在 appendCheckpointScores 中保存 lostDays 值，供当前逻辑读取或更新。 |
| 511 | missingDays | const | appendMissingTailScores | 推断: BinaryExpression | 变量，在 appendMissingTailScores 中保存 missingDays 值，供当前逻辑读取或更新。 |
| 516 | avgIncrementValue | const | appendMissingTailScores | 推断: CallExpression | 变量，在 appendMissingTailScores 中保存 avgIncrement值 值，供当前逻辑读取或更新。 |
| 520 | i | let | appendMissingTailScores | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 540 | dailyIncrement | const | toDailyIncrementList | 推断: ArrayLiteralExpression | 变量，在 toDailyIncrementList 中保存 日增Increment 值，供当前逻辑读取或更新。 |
| 541 | i | let | toDailyIncrementList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 563 | score | const | getDailyIncrement | 推断: CallExpression | 变量，在 getDailyIncrement 中保存 分数 值，供当前逻辑读取或更新。 |
| 563 | time | const | getDailyIncrement | 推断: CallExpression | 变量，在 getDailyIncrement 中保存 时间 值，供当前逻辑读取或更新。 |
| 564 | invalidDays | const | getDailyIncrement | 推断: NewExpression | 变量，在 getDailyIncrement 中保存 invalidDays 值，供当前逻辑读取或更新。 |
| 565 | scoreFinal | const | getDailyIncrement | number[] | 变量，在 getDailyIncrement 中保存 分数最终 值，供当前逻辑读取或更新。 |
| 566 | cutoffLastDataDays | const | getDailyIncrement | 推断: CallExpression | 变量，在 getDailyIncrement 中保存 档线Last数据Days 值，供当前逻辑读取或更新。 |
| 569 | startDayIndex | const | getDailyIncrement | 推断: ConditionalExpression | 变量，在 getDailyIncrement 中保存 startDay下标 值，供当前逻辑读取或更新。 |
| 603 | lastCutoffTime | let | getYesterdayIncrementRate | 推断: PropertyAccessExpression | 变量，在 getYesterdayIncrementRate 中保存 last档线时间 值，供当前逻辑读取或更新。 |
| 605 | usePrevPoint | let | getYesterdayIncrementRate | 推断: FalseKeyword | 变量，在 getYesterdayIncrementRate 中保存 usePrevPoint 值，供当前逻辑读取或更新。 |
| 606 | UTCMin | const | getYesterdayIncrementRate | 推断: CallExpression | 变量，在 getYesterdayIncrementRate 中保存 UTC最小值 值，供当前逻辑读取或更新。 |
| 610 | UTCHour | const | getYesterdayIncrementRate | 推断: CallExpression | 变量，在 getYesterdayIncrementRate 中保存 UTCHour 值，供当前逻辑读取或更新。 |
| 614 | lengthLimit | let | getYesterdayIncrementRate | 推断: FirstLiteralToken | 变量，在 getYesterdayIncrementRate 中保存 lengthLimit 值，供当前逻辑读取或更新。 |
| 620 | curEventDays | const | getYesterdayIncrementRate | 推断: CallExpression | 变量，在 getYesterdayIncrementRate 中保存 cur活动Days 值，供当前逻辑读取或更新。 |
| 621 | lastCutoffEp | const | getYesterdayIncrementRate | 推断: PropertyAccessExpression | 变量，在 getYesterdayIncrementRate 中保存 last档线Ep 值，供当前逻辑读取或更新。 |
| 623 | score | const | getYesterdayIncrementRate | number[] | 变量，在 getYesterdayIncrementRate 中保存 分数 值，供当前逻辑读取或更新。 |
| 624 | time | const | getYesterdayIncrementRate | number[] | 变量，在 getYesterdayIncrementRate 中保存 时间 值，供当前逻辑读取或更新。 |
| 625 | scoreCur | const | getYesterdayIncrementRate | number[] | 变量，在 getYesterdayIncrementRate 中保存 分数Cur 值，供当前逻辑读取或更新。 |
| 626 | timeCur | const | getYesterdayIncrementRate | number[] | 变量，在 getYesterdayIncrementRate 中保存 时间Cur 值，供当前逻辑读取或更新。 |
| 627 | dateNow | const | getYesterdayIncrementRate | 推断: CallExpression | 变量，在 getYesterdayIncrementRate 中保存 dateNow 值，供当前逻辑读取或更新。 |
| 628 | lastestUtcHour | const | getYesterdayIncrementRate | 推断: CallExpression | 变量，在 getYesterdayIncrementRate 中保存 lastestUtcHour 值，供当前逻辑读取或更新。 |
| 629 | lastestUtcMinutes | const | getYesterdayIncrementRate | 推断: CallExpression | 变量，在 getYesterdayIncrementRate 中保存 lastestUtcMinutes 值，供当前逻辑读取或更新。 |
| 631 | c | const | getYesterdayIncrementRate | 推断 | 变量，在 getYesterdayIncrementRate 中保存 c 值，供当前逻辑读取或更新。 |
| 632 | allowPushFlag | let | getYesterdayIncrementRate | 推断: FalseKeyword | 变量，在 getYesterdayIncrementRate 中保存 allowPushFlag 值，供当前逻辑读取或更新。 |
| 633 | timestamp | const | getYesterdayIncrementRate | 推断: CallExpression | 变量，在 getYesterdayIncrementRate 中保存 timestamp 值，供当前逻辑读取或更新。 |
| 634 | d | const | getYesterdayIncrementRate | 推断: CallExpression | 变量，在 getYesterdayIncrementRate 中保存 d 值，供当前逻辑读取或更新。 |
| 641 | date | const | getYesterdayIncrementRate | 推断: CallExpression | 变量，在 getYesterdayIncrementRate 中保存 date 值，供当前逻辑读取或更新。 |
| 666 | TodaysIncrement | const | getYesterdayIncrementRate | 推断: BinaryExpression | 变量，在 getYesterdayIncrementRate 中保存 TodaysIncrement 值，供当前逻辑读取或更新。 |
| 667 | YesterdaysIncrement | const | getYesterdayIncrementRate | 推断: BinaryExpression | 变量，在 getYesterdayIncrementRate 中保存 YesterdaysIncrement 值，供当前逻辑读取或更新。 |
| 668 | rate | const | getYesterdayIncrementRate | number | 变量，在 getYesterdayIncrementRate 中保存 概率 值，供当前逻辑读取或更新。 |
| 670 | result | const | getYesterdayIncrementRate | 推断: TemplateExpression | 保存当前函数最终返回或阶段性处理结果。 |
| 679 | x | type-field | getChartData | Date | 保存当前横向绘制坐标。 |
| 679 | y | type-field | getChartData | number | 保存当前纵向绘制坐标。 |
| 683 | chartData | const | getChartData | { x: Date; y: number }[] | 变量，在 getChartData 中保存 谱面数据 值，供当前逻辑读取或更新。 |
| 683 | x | type-field | chartData | Date | 保存当前横向绘制坐标。 |
| 683 | y | type-field | chartData | number | 保存当前纵向绘制坐标。 |
| 691 | tempTime | let | getChartData | 推断: ConditionalExpression | 变量，在 getChartData 中保存 临时时间 值，供当前逻辑读取或更新。 |
| 695 | i | let | getChartData | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 696 | element | const | getChartData | 推断: ElementAccessExpression | 变量，在 getChartData 中保存 element 值，供当前逻辑读取或更新。 |

### models/degree.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 23 | constructor | constructor | Degree | degreeId: 推断 | - | 构造 Degree 实例，并初始化该模型的本地基础字段。 |
| 43 | getDegreeImage | method | Degree | server: Server | Promise<Image \| Canvas> | 在 Degree 模型中获取称号图片。 |
| 76 | getDegreeFrame | method | Degree | server: Server | Promise<Image \| Canvas> | 在 Degree 模型中获取称号Frame。 |
| 94 | getDegreeIcon | method | Degree | server: Server | Promise<Image \| Canvas> | 在 Degree 模型中获取称号图标。 |
| 130 | getFrameFromAnimatedDegreeAsset | function | 模块顶层 | baseImageName: string; server: Server; frame: number | Promise<Canvas> | 在BangDream 领域模型层中获取FrameFromAnimated称号资源。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 10 | degreeId | class-field | Degree | number | 保存 称号ID，用于定位对应业务实体。 |
| 11 | isExist | class-field | Degree | 推断: FalseKeyword | 布尔标记，表示 isExist 的判断结果。 |
| 12 | data | class-field | Degree | object | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 13 | degreeType | class-field | Degree | Array<string \| null> | 字段，在 Degree 中保存 称号类型 值，供当前逻辑读取或更新。 |
| 14 | iconImageName | class-field | Degree | Array<string \| null> | 字段，在 Degree 中保存 icon图片名称 值，供当前逻辑读取或更新。 |
| 15 | baseImageName | class-field | Degree | Array<string \| null> | 字段，在 Degree 中保存 基础图片名称 值，供当前逻辑读取或更新。 |
| 16 | rank | class-field | Degree | Array<string \| null> | 字段，在 Degree 中保存 rank 值，供当前逻辑读取或更新。 |
| 17 | degreeName | class-field | Degree | Array<string \| null> | 字段，在 Degree 中保存 称号名称 值，供当前逻辑读取或更新。 |
| 25 | degreeData | const | Degree | 推断: ElementAccessExpression | 变量，在 Degree 中保存 称号数据 值，供当前逻辑读取或更新。 |
| 44 | temp_baseImageName | const | getDegreeImage | 推断: ElementAccessExpression | 变量，在 getDegreeImage 中保存 临时基础图片名称 值，供当前逻辑读取或更新。 |
| 48 | degreeImageBuffer | const | getDegreeImage | 推断: AwaitExpression | 保存 称号图片缓冲区，用于二进制资源处理。 |
| 57 | degreeImageBuffer | const | getDegreeImage | 推断: AwaitExpression | 保存 称号图片缓冲区，用于二进制资源处理。 |
| 63 | degreeImageBuffer | const | getDegreeImage | 推断: AwaitExpression | 保存 称号图片缓冲区，用于二进制资源处理。 |
| 77 | frameName | const | getDegreeFrame | 推断: BinaryExpression | 变量，在 getDegreeFrame 中保存 frame名称 值，供当前逻辑读取或更新。 |
| 83 | degreeFrameBuffer | const | getDegreeFrame | 推断: AwaitExpression | 保存 称号Frame缓冲区，用于二进制资源处理。 |
| 95 | iconName | const | getDegreeIcon | 推断: BinaryExpression | 变量，在 getDegreeIcon 中保存 icon名称 值，供当前逻辑读取或更新。 |
| 100 | degreeIconBuffer | const | getDegreeIcon | 推断: AwaitExpression | 保存 称号Icon缓冲区，用于二进制资源处理。 |
| 107 | name | class-field | Frame | string | 字段，在 Frame 中保存 名称 值，供当前逻辑读取或更新。 |
| 108 | x | class-field | Frame | number | 保存当前横向绘制坐标。 |
| 109 | y | class-field | Frame | number | 保存当前纵向绘制坐标。 |
| 110 | width | class-field | Frame | number | 保存当前绘制宽度。 |
| 111 | height | class-field | Frame | number | 保存当前绘制高度。 |
| 112 | borderLeft | class-field | Frame | number | 字段，在 Frame 中保存 borderLeft 值，供当前逻辑读取或更新。 |
| 113 | borderRight | class-field | Frame | number | 字段，在 Frame 中保存 borderRight 值，供当前逻辑读取或更新。 |
| 114 | borderTop | class-field | Frame | number | 字段，在 Frame 中保存 borderTop 值，供当前逻辑读取或更新。 |
| 115 | borderBottom | class-field | Frame | number | 字段，在 Frame 中保存 borderBottom 值，供当前逻辑读取或更新。 |
| 116 | paddingLeft | class-field | Frame | number | 字段，在 Frame 中保存 paddingLeft 值，供当前逻辑读取或更新。 |
| 117 | paddingRight | class-field | Frame | number | 字段，在 Frame 中保存 paddingRight 值，供当前逻辑读取或更新。 |
| 118 | paddingTop | class-field | Frame | number | 字段，在 Frame 中保存 paddingTop 值，供当前逻辑读取或更新。 |
| 119 | paddingBottom | class-field | Frame | number | 字段，在 Frame 中保存 paddingBottom 值，供当前逻辑读取或更新。 |
| 137 | scriptUrl | const | getFrameFromAnimatedDegreeAsset | 推断: TemplateExpression | 保存 scriptURL，用于请求接口或下载资源。 |
| 138 | srciptBuffer | const | getFrameFromAnimatedDegreeAsset | 推断: AwaitExpression | 保存 srcipt缓冲区，用于二进制资源处理。 |
| 139 | script | const | getFrameFromAnimatedDegreeAsset | 推断: AwaitExpression | 变量，在 getFrameFromAnimatedDegreeAsset 中保存 script 值，供当前逻辑读取或更新。 |
| 140 | frames | const | getFrameFromAnimatedDegreeAsset | Array<Frame> | 变量，在 getFrameFromAnimatedDegreeAsset 中保存 frames 值，供当前逻辑读取或更新。 |
| 141 | framecount | const | getFrameFromAnimatedDegreeAsset | 推断: PropertyAccessExpression | 变量，在 getFrameFromAnimatedDegreeAsset 中保存 framecount 值，供当前逻辑读取或更新。 |
| 150 | textureUrlOld | const | getFrameFromAnimatedDegreeAsset | 推断: TemplateExpression | 变量，在 getFrameFromAnimatedDegreeAsset 中保存 textureURLOld 值，供当前逻辑读取或更新。 |
| 151 | textureUrlNew | const | getFrameFromAnimatedDegreeAsset | 推断: TemplateExpression | 变量，在 getFrameFromAnimatedDegreeAsset 中保存 textureURLNew 值，供当前逻辑读取或更新。 |
| 153 | useTextureUrlOldAssetWhitelist | const | getFrameFromAnimatedDegreeAsset | 推断: ArrayLiteralExpression | 变量，在 getFrameFromAnimatedDegreeAsset 中保存 useTextureURLOld资源Whitelist 值，供当前逻辑读取或更新。 |
| 159 | useTextureUrlOld | let | getFrameFromAnimatedDegreeAsset | 推断: FalseKeyword | 变量，在 getFrameFromAnimatedDegreeAsset 中保存 useTextureURLOld 值，供当前逻辑读取或更新。 |
| 160 | l | const | getFrameFromAnimatedDegreeAsset | 推断 | 变量，在 getFrameFromAnimatedDegreeAsset 中保存 l 值，供当前逻辑读取或更新。 |
| 166 | textureBuffer | const | getFrameFromAnimatedDegreeAsset | 推断: AwaitExpression | 保存 texture缓冲区，用于二进制资源处理。 |
| 169 | texture | const | getFrameFromAnimatedDegreeAsset | 推断: AwaitExpression | 变量，在 getFrameFromAnimatedDegreeAsset 中保存 texture 值，供当前逻辑读取或更新。 |
| 172 | frameData | const | getFrameFromAnimatedDegreeAsset | 推断: ElementAccessExpression | 变量，在 getFrameFromAnimatedDegreeAsset 中保存 frame数据 值，供当前逻辑读取或更新。 |
| 173 | canvas | const | getFrameFromAnimatedDegreeAsset | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 174 | ctx | const | getFrameFromAnimatedDegreeAsset | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |

### models/event-stage.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 36 | constructor | constructor | EventStage | eventId: number | - | 构造 EventStage 实例，并初始化该模型的本地基础字段。 |
| 52 | initFull | method | EventStage | - | 推断 | 在 EventStage 模型中加载远端完整详情并标记初始化状态。 |
| 75 | getData | method | EventStage | update: boolean; type: 'stages' \| 'rotationMusics' | 推断 | 在 EventStage 模型中请求当前模型的远端详情数据。 |
| 89 | getStageList | method | EventStage | - | Stage[] | 在 EventStage 模型中获取试炼列表。 |
| 120 | <anonymous> | callback | getStageList | a: 推断; b: 推断 | 推断 | 作为 \`tempStageList.sort\` 的回调，处理 a、b。 |
| 134 | getStageTypeByTime | method | EventStage | startAt: number; endAt: number | string | 在 EventStage 模型中获取试炼类型By时间。 |
| 139 | <anonymous> | callback | stage | x: 推断 | 推断 | 作为 \`this.stageType.find\` 的回调，处理 x。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 12 | type | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 类型 值，供当前逻辑读取或更新。 |
| 13 | startAt | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 startAt 值，供当前逻辑读取或更新。 |
| 14 | endAt | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 endAt 值，供当前逻辑读取或更新。 |
| 15 | songIdList | type-field | 模块顶层 | Array<number> | 保存 歌曲ID列表，用于按顺序遍历或批量渲染。 |
| 18 | stageTypeList | const | 模块顶层 | string[] | 保存 试炼类型列表，用于按顺序遍历或批量渲染。 |
| 20 | stageTypeTextStrokeColor | const | 模块顶层 | Record<string, string> | 变量，在 模块顶层 中保存 试炼类型文本Stroke颜色 值，供当前逻辑读取或更新。 |
| 23 | stageTypeName | const | 模块顶层 | Record<string, string> | 变量，在 模块顶层 中保存 试炼类型名称 值，供当前逻辑读取或更新。 |
| 26 | eventId | class-field | EventStage | number | 保存 活动ID，用于定位对应业务实体。 |
| 27 | isExist | class-field | EventStage | boolean | 布尔标记，表示 isExist 的判断结果。 |
| 28 | isInitFull | class-field | EventStage | 推断: FalseKeyword | 布尔标记，表示 isInitFull 的判断结果。 |
| 29 | stageType | class-field | EventStage | Array<{ type: string; startAt: string; endAt: string }> | 字段，在 EventStage 中保存 试炼类型 值，供当前逻辑读取或更新。 |
| 29 | type | type-field | EventStage | string | 字段，在 EventStage 中保存 类型 值，供当前逻辑读取或更新。 |
| 29 | startAt | type-field | EventStage | string | 字段，在 EventStage 中保存 startAt 值，供当前逻辑读取或更新。 |
| 29 | endAt | type-field | EventStage | string | 字段，在 EventStage 中保存 endAt 值，供当前逻辑读取或更新。 |
| 30 | rotationMusics | class-field | EventStage | Array<{ musicId: string; startAt: string; endAt: string }> | 字段，在 EventStage 中保存 rotation音乐列表 值，供当前逻辑读取或更新。 |
| 30 | musicId | type-field | EventStage | string | 保存 音乐ID，用于定位对应业务实体。 |
| 30 | startAt | type-field | EventStage | string | 字段，在 EventStage 中保存 startAt 值，供当前逻辑读取或更新。 |
| 30 | endAt | type-field | EventStage | string | 字段，在 EventStage 中保存 endAt 值，供当前逻辑读取或更新。 |
| 38 | event | const | EventStage | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 60 | stageData | const | initFull | 推断: AwaitExpression | 变量，在 initFull 中保存 试炼数据 值，供当前逻辑读取或更新。 |
| 61 | rotationMusicsData | const | initFull | 推断: AwaitExpression | 变量，在 initFull 中保存 rotation音乐列表数据 值，供当前逻辑读取或更新。 |
| 76 | time | const | getData | 推断: ConditionalExpression | 变量，在 getData 中保存 时间 值，供当前逻辑读取或更新。 |
| 77 | eventData | const | getData | 推断: AwaitExpression | 变量，在 getData 中保存 活动数据 值，供当前逻辑读取或更新。 |
| 94 | temp | const | getStageList | 推断: ObjectLiteralExpression | 变量，在 getStageList 中保存 临时 值，供当前逻辑读取或更新。 |
| 95 | i | const | getStageList | 推断 | 保存循环下标或对象键。 |
| 96 | tempStartAt | const | getStageList | 推断: PropertyAccessExpression | 变量，在 getStageList 中保存 临时StartAt 值，供当前逻辑读取或更新。 |
| 106 | tempStageList | const | getStageList | Stage[] | 保存 临时试炼列表，用于按顺序遍历或批量渲染。 |
| 107 | i | const | getStageList | 推断 | 保存循环下标或对象键。 |
| 108 | element | const | getStageList | 推断: ElementAccessExpression | 变量，在 getStageList 中保存 element 值，供当前逻辑读取或更新。 |
| 109 | tempStartAt | const | getStageList | 推断: CallExpression | 变量，在 getStageList 中保存 临时StartAt 值，供当前逻辑读取或更新。 |
| 110 | tempEndAt | const | getStageList | 推断: CallExpression | 变量，在 getStageList 中保存 临时EndAt 值，供当前逻辑读取或更新。 |
| 111 | tempStageType | const | getStageList | 推断: CallExpression | 变量，在 getStageList 中保存 临时试炼类型 值，供当前逻辑读取或更新。 |
| 139 | stage | const | getStageTypeByTime | 推断: CallExpression | 变量，在 getStageTypeByTime 中保存 试炼 值，供当前逻辑读取或更新。 |
| 140 | startTime | const | stage | 推断: CallExpression | 变量，在 stage 中保存 start时间 值，供当前逻辑读取或更新。 |
| 141 | endTime | const | stage | 推断: CallExpression | 变量，在 stage 中保存 end时间 值，供当前逻辑读取或更新。 |

### models/event.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 99 | constructor | constructor | Event | eventId: number | - | 构造 Event 实例，并初始化该模型的本地基础字段。 |
| 150 | initFull | method | Event | useCache: boolean | 推断 | 在 Event 模型中加载远端完整详情并标记初始化状态。 |
| 198 | getData | method | Event | update: boolean | 推断 | 在 Event 模型中请求当前模型的远端详情数据。 |
| 212 | getBannerImage | method | Event | displayedServerList: Server[] | Promise<Image> | 在 Event 模型中获取横幅图片。 |
| 236 | getEventBGImage | method | Event | - | Promise<Image> | 在 Event 模型中获取活动背景图片。 |
| 250 | getEventSlideImage | method | Event | tempServer: Server | Promise<Image[]> | 在 Event 模型中获取活动Slide图片。 |
| 273 | getEventTopscreenTrimImage | method | Event | - | Promise<Image> | 在 Event 模型中获取活动TopscreenTrim图片。 |
| 285 | getEventLogoImage | method | Event | tempServer: Server | Promise<Image> | 在 Event 模型中获取活动Logo图片。 |
| 295 | getTypeName | method | Event | - | 推断 | 在 Event 模型中获取类型名称。 |
| 304 | getAttributeList | method | Event | - | 推断 | 在 Event 模型中获取属性列表。 |
| 325 | getCharacterList | method | Event | - | 推断 | 在 Event 模型中获取角色列表。 |
| 348 | getRewardStamp | method | Event | server: Server | Promise<Image> | 在 Event 模型中获取奖励Stamp。 |
| 388 | getRewardDeco | method | Event | server: Server | Promise<Image> | 在 Event 模型中获取奖励Deco。 |
| 434 | getPresentEvent | function | 模块顶层 | server: Server; time: number | 推断 | 在BangDream 领域模型层中获取Present活动。 |
| 486 | sortEventList | function | 模块顶层 | tempEventList: Event[]; displayedServerList: Server[] | 推断 | 在BangDream 领域模型层中排序活动列表。 |
| 491 | <anonymous> | callback | sortEventList | a: 推断; b: 推断 | 推断 | 作为 \`tempEventList.sort\` 的回调，处理 a、b。 |
| 531 | getRecentEventListByEventAndServer | function | 模块顶层 | event: Event; server: Server; count: number; sameType: boolean | 推断 | 在BangDream 领域模型层中获取最近活动列表By活动And服务器。 |
| 539 | <anonymous> | callback | getRecentEventListByEventAndServer | a: 推断; b: 推断 | 推断 | 作为 \`eventIdList.sort\` 的回调，处理 a、b。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 19 | typeName | const | 模块顶层 | Record<string, string> | 变量，在 模块顶层 中保存 类型名称 值，供当前逻辑读取或更新。 |
| 22 | eventId | class-field | Event | number | 保存 活动ID，用于定位对应业务实体。 |
| 23 | isExist | class-field | Event | boolean | 布尔标记，表示 isExist 的判断结果。 |
| 24 | isInitFull | class-field | Event | 推断: FalseKeyword | 布尔标记，表示 isInitFull 的判断结果。 |
| 25 | eventType | class-field | Event | string | 字段，在 Event 中保存 活动类型 值，供当前逻辑读取或更新。 |
| 26 | eventName | class-field | Event | Array<string \| null> | 字段，在 Event 中保存 活动名称 值，供当前逻辑读取或更新。 |
| 27 | bannerAssetBundleName | class-field | Event | string | 字段，在 Event 中保存 横幅资源Bundle名称 值，供当前逻辑读取或更新。 |
| 28 | startAt | class-field | Event | Array<number \| null> | 字段，在 Event 中保存 startAt 值，供当前逻辑读取或更新。 |
| 29 | endAt | class-field | Event | Array<number \| null> | 字段，在 Event 中保存 endAt 值，供当前逻辑读取或更新。 |
| 30 | attributes | class-field | Event | Array<{ attribute: 'happy' \| 'cool' \| 'powerful' \| 'pure'; percent: number; }> | 字段，在 Event 中保存 属性列表 值，供当前逻辑读取或更新。 |
| 31 | attribute | type-field | Event | 'happy' \| 'cool' \| 'powerful' \| 'pure' | 字段，在 Event 中保存 属性 值，供当前逻辑读取或更新。 |
| 32 | percent | type-field | Event | number | 字段，在 Event 中保存 percent 值，供当前逻辑读取或更新。 |
| 34 | characters | class-field | Event | Array<{ characterId: number; percent: number; }> | 字段，在 Event 中保存 角色列表 值，供当前逻辑读取或更新。 |
| 35 | characterId | type-field | Event | number | 保存 角色ID，用于定位对应业务实体。 |
| 36 | percent | type-field | Event | number | 字段，在 Event 中保存 percent 值，供当前逻辑读取或更新。 |
| 38 | eventAttributeAndCharacterBonus | class-field | Event | { pointPercent: number; parameterPercent: number; } | 字段，在 Event 中保存 活动属性And角色加成 值，供当前逻辑读取或更新。 |
| 39 | pointPercent | type-field | Event | number | 字段，在 Event 中保存 pointPercent 值，供当前逻辑读取或更新。 |
| 40 | parameterPercent | type-field | Event | number | 字段，在 Event 中保存 parameterPercent 值，供当前逻辑读取或更新。 |
| 42 | musics | class-field | Event | Array<Array<{ musicId: number; musicRankingRewards?: Array<{ fromRank: number; toRank: number; resourceType: string; resourceId: number; quantity: number; }>; }> \| null> | 字段，在 Event 中保存 音乐列表 值，供当前逻辑读取或更新。 |
| 43 | musicId | type-field | Event | number | 保存 音乐ID，用于定位对应业务实体。 |
| 44 | musicRankingRewards | type-field | Event | Array<{ fromRank: number; toRank: number; resourceType: string; resourceId: number; quantity: number; }> | 字段，在 Event 中保存 音乐Ranking奖励列表 值，供当前逻辑读取或更新。 |
| 45 | fromRank | type-field | Event | number | 字段，在 Event 中保存 fromRank 值，供当前逻辑读取或更新。 |
| 46 | toRank | type-field | Event | number | 字段，在 Event 中保存 toRank 值，供当前逻辑读取或更新。 |
| 47 | resourceType | type-field | Event | string | 字段，在 Event 中保存 resource类型 值，供当前逻辑读取或更新。 |
| 48 | resourceId | type-field | Event | number | 保存 resourceID，用于定位对应业务实体。 |
| 49 | quantity | type-field | Event | number | 字段，在 Event 中保存 quantity 值，供当前逻辑读取或更新。 |
| 52 | rewardCards | class-field | Event | Array<number> | 字段，在 Event 中保存 奖励卡牌列表 值，供当前逻辑读取或更新。 |
| 56 | assetBundleName | class-field | Event | string | 字段，在 Event 中保存 资源Bundle名称 值，供当前逻辑读取或更新。 |
| 57 | publicStartAt | class-field | Event | Array<number \| null> | 字段，在 Event 中保存 publicStartAt 值，供当前逻辑读取或更新。 |
| 58 | publicEndAt | class-field | Event | Array<number \| null> | 字段，在 Event 中保存 publicEndAt 值，供当前逻辑读取或更新。 |
| 67 | pointRewards | class-field | Event | Array<Array<{ point: string; rewardType: string; rewardId?: number; rewardQuantity: number; }> \| null> | 字段，在 Event 中保存 point奖励列表 值，供当前逻辑读取或更新。 |
| 68 | point | type-field | Event | string | 字段，在 Event 中保存 point 值，供当前逻辑读取或更新。 |
| 69 | rewardType | type-field | Event | string | 字段，在 Event 中保存 奖励类型 值，供当前逻辑读取或更新。 |
| 70 | rewardId | type-field | Event | number | 保存 奖励ID，用于定位对应业务实体。 |
| 71 | rewardQuantity | type-field | Event | number | 字段，在 Event 中保存 奖励Quantity 值，供当前逻辑读取或更新。 |
| 73 | rankingRewards | class-field | Event | Array<Array<{ fromRank: number; toRank: number; rewardType: string; rewardId: number; rewardQuantity: number; }> \| null> | 字段，在 Event 中保存 ranking奖励列表 值，供当前逻辑读取或更新。 |
| 74 | fromRank | type-field | Event | number | 字段，在 Event 中保存 fromRank 值，供当前逻辑读取或更新。 |
| 75 | toRank | type-field | Event | number | 字段，在 Event 中保存 toRank 值，供当前逻辑读取或更新。 |
| 76 | rewardType | type-field | Event | string | 字段，在 Event 中保存 奖励类型 值，供当前逻辑读取或更新。 |
| 77 | rewardId | type-field | Event | number | 保存 奖励ID，用于定位对应业务实体。 |
| 78 | rewardQuantity | type-field | Event | number | 字段，在 Event 中保存 奖励Quantity 值，供当前逻辑读取或更新。 |
| 80 | eventCharacterParameterBonus | class-field | Event | { //偏科 performance?: number; technique?: number; visual?: number; } | 字段，在 Event 中保存 活动角色Parameter加成 值，供当前逻辑读取或更新。 |
| 82 | performance | type-field | Event | number | 字段，在 Event 中保存 performance 值，供当前逻辑读取或更新。 |
| 83 | technique | type-field | Event | number | 字段，在 Event 中保存 technique 值，供当前逻辑读取或更新。 |
| 84 | visual | type-field | Event | number | 字段，在 Event 中保存 visual 值，供当前逻辑读取或更新。 |
| 88 | characterId | class-field | Event | number[] | 保存 角色ID，用于定位对应业务实体。 |
| 89 | attribute | class-field | Event | string[] | 字段，在 Event 中保存 属性 值，供当前逻辑读取或更新。 |
| 90 | bandId | class-field | Event | number[] | 保存 乐队ID，用于定位对应业务实体。 |
| 92 | isInitfull | class-field | Event | boolean | 布尔标记，表示 isInitfull 的判断结果。 |
| 101 | eventData | const | Event | 推断: ElementAccessExpression | 变量，在 Event 中保存 活动数据 值，供当前逻辑读取或更新。 |
| 118 | i | let | Event | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 119 | element | const | Event | 推断: ElementAccessExpression | 变量，在 Event 中保存 element 值，供当前逻辑读取或更新。 |
| 123 | i | let | Event | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 124 | element | const | Event | 推断: ElementAccessExpression | 变量，在 Event 中保存 element 值，供当前逻辑读取或更新。 |
| 129 | isSameBand | let | Event | 推断: TrueKeyword | 布尔标记，表示 isSame乐队 的判断结果。 |
| 130 | i | let | Event | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 158 | eventData | const | initFull | 推断: AwaitExpression | 变量，在 initFull 中保存 活动数据 值，供当前逻辑读取或更新。 |
| 199 | time | const | getData | 推断: ConditionalExpression | 变量，在 getData 中保存 时间 值，供当前逻辑读取或更新。 |
| 200 | eventData | const | getData | 推断: AwaitExpression | 变量，在 getData 中保存 活动数据 值，供当前逻辑读取或更新。 |
| 216 | server | const | getBannerImage | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 218 | BannerImageBuffer | const | getBannerImage | 推断: AwaitExpression | 保存 横幅图片缓冲区，用于二进制资源处理。 |
| 224 | server | const | getBannerImage | 推断: PropertyAccessExpression | 保存当前目标服务器枚举或服务器代码。 |
| 225 | BannerImageBuffer | const | getBannerImage | 推断: AwaitExpression | 保存 横幅图片缓冲区，用于二进制资源处理。 |
| 237 | server | const | getEventBGImage | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 238 | BGImageBuffer | const | getEventBGImage | 推断: AwaitExpression | 保存 BG图片缓冲区，用于二进制资源处理。 |
| 251 | server | const | getEventSlideImage | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 252 | result | const | getEventSlideImage | Image[] | 保存当前函数最终返回或阶段性处理结果。 |
| 253 | baseUrl | const | getEventSlideImage | 推断: TemplateExpression | 保存 基础URL，用于请求接口或下载资源。 |
| 254 | ruleNumber | let | getEventSlideImage | 推断: FirstLiteralToken | 变量，在 getEventSlideImage 中保存 rule数字 值，供当前逻辑读取或更新。 |
| 257 | url | const | getEventSlideImage | 推断: TemplateExpression | 保存远端接口或资源下载地址。 |
| 258 | SlideImageBuffer | const | getEventSlideImage | 推断: AwaitExpression | 保存 Slide图片缓冲区，用于二进制资源处理。 |
| 274 | server | const | getEventTopscreenTrimImage | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 275 | url | const | getEventTopscreenTrimImage | 推断: TemplateExpression | 保存远端接口或资源下载地址。 |
| 276 | TopscreenTrimImageBuffer | const | getEventTopscreenTrimImage | 推断: AwaitExpression | 保存 TopscreenTrim图片缓冲区，用于二进制资源处理。 |
| 286 | server | const | getEventLogoImage | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 287 | LogoImageBuffer | const | getEventLogoImage | 推断: AwaitExpression | 保存 Logo图片缓冲区，用于二进制资源处理。 |
| 306 | attribute | const | getAttributeList | 推断: PropertyAccessExpression | 变量，在 getAttributeList 中保存 属性 值，供当前逻辑读取或更新。 |
| 307 | attributeList | const | getAttributeList | { [percent: string]: Array<Attribute> } | 保存 属性列表，用于按顺序遍历或批量渲染。 |
| 308 | i | const | getAttributeList | 推断 | 保存循环下标或对象键。 |
| 310 | element | const | getAttributeList | 推断: ElementAccessExpression | 变量，在 getAttributeList 中保存 element 值，供当前逻辑读取或更新。 |
| 311 | percent | const | getAttributeList | 推断: PropertyAccessExpression | 变量，在 getAttributeList 中保存 percent 值，供当前逻辑读取或更新。 |
| 326 | character | const | getCharacterList | 推断: PropertyAccessExpression | 保存当前角色领域模型实例。 |
| 327 | characterList | const | getCharacterList | { [percent: string]: Array<Character> } | 保存 角色列表，用于按顺序遍历或批量渲染。 |
| 328 | i | const | getCharacterList | 推断 | 保存循环下标或对象键。 |
| 330 | element | const | getCharacterList | 推断: ElementAccessExpression | 变量，在 getCharacterList 中保存 element 值，供当前逻辑读取或更新。 |
| 331 | percent | const | getCharacterList | 推断: PropertyAccessExpression | 变量，在 getCharacterList 中保存 percent 值，供当前逻辑读取或更新。 |
| 349 | allStamps | const | getRewardStamp | 推断: AwaitExpression | 变量，在 getRewardStamp 中保存 allStamps 值，供当前逻辑读取或更新。 |
| 352 | rewards | const | getRewardStamp | 推断: ElementAccessExpression | 变量，在 getRewardStamp 中保存 奖励列表 值，供当前逻辑读取或更新。 |
| 353 | rewardId | let | getRewardStamp | 推断: PrefixUnaryExpression | 保存 奖励ID，用于定位对应业务实体。 |
| 354 | i | let | getRewardStamp | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 360 | stampAssetName | let | getRewardStamp | 推断: StringLiteral | 变量，在 getRewardStamp 中保存 stamp资源名称 值，供当前逻辑读取或更新。 |
| 361 | i | const | getRewardStamp | 推断 | 保存循环下标或对象键。 |
| 369 | serverName | let | getRewardStamp | 推断: StringLiteral | 变量，在 getRewardStamp 中保存 服务器名称 值，供当前逻辑读取或更新。 |
| 374 | stampBuffer | const | getRewardStamp | 推断: AwaitExpression | 保存 stamp缓冲区，用于二进制资源处理。 |
| 389 | allDeco | const | getRewardDeco | 推断: ElementAccessExpression | 变量，在 getRewardDeco 中保存 allDeco 值，供当前逻辑读取或更新。 |
| 394 | rewards | const | getRewardDeco | 推断: CallExpression | 变量，在 getRewardDeco 中保存 奖励列表 值，供当前逻辑读取或更新。 |
| 395 | rewardId | let | getRewardDeco | 推断: PrefixUnaryExpression | 保存 奖励ID，用于定位对应业务实体。 |
| 396 | i | let | getRewardDeco | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 403 | decoAssetName | let | getRewardDeco | 推断: StringLiteral | 变量，在 getRewardDeco 中保存 deco资源名称 值，供当前逻辑读取或更新。 |
| 404 | i | const | getRewardDeco | 推断 | 保存循环下标或对象键。 |
| 412 | serverName | let | getRewardDeco | 推断: StringLiteral | 变量，在 getRewardDeco 中保存 服务器名称 值，供当前逻辑读取或更新。 |
| 417 | decoBuffer | const | getRewardDeco | 推断: AwaitExpression | 保存 deco缓冲区，用于二进制资源处理。 |
| 438 | eventList | const | getPresentEvent | Array<number> | 保存 活动列表，用于按顺序遍历或批量渲染。 |
| 439 | eventListMain | const | getPresentEvent | 推断: ElementAccessExpression | 变量，在 getPresentEvent 中保存 活动列表主数据 值，供当前逻辑读取或更新。 |
| 440 | key | const | getPresentEvent | 推断 | 变量，在 getPresentEvent 中保存 key 值，供当前逻辑读取或更新。 |
| 441 | event | const | getPresentEvent | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 453 | eventEndAtFlags | let | getPresentEvent | number | 变量，在 getPresentEvent 中保存 活动EndAtFlags 值，供当前逻辑读取或更新。 |
| 456 | key | const | getPresentEvent | 推断 | 变量，在 getPresentEvent 中保存 key 值，供当前逻辑读取或更新。 |
| 457 | event | const | getPresentEvent | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 490 | presentEventCN | const | sortEventList | 推断: CallExpression | 变量，在 sortEventList 中保存 present活动CN 值，供当前逻辑读取或更新。 |
| 492 | i | let | sortEventList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 493 | server | const | sortEventList | 推断: ElementAccessExpression | 保存当前目标服务器枚举或服务器代码。 |
| 497 | prvEvent | let | sortEventList | 推断: NullKeyword | 变量，在 sortEventList 中保存 prv活动 值，供当前逻辑读取或更新。 |
| 498 | nxtEvent | let | sortEventList | 推断: NullKeyword | 变量，在 sortEventList 中保存 nxt活动 值，供当前逻辑读取或更新。 |
| 537 | eventIdList | const | getRecentEventListByEventAndServer | Array<number> | 保存 活动ID列表，用于按顺序遍历或批量渲染。 |
| 540 | eventA | const | getRecentEventListByEventAndServer | 推断: NewExpression | 变量，在 getRecentEventListByEventAndServer 中保存 活动A 值，供当前逻辑读取或更新。 |
| 541 | eventB | const | getRecentEventListByEventAndServer | 推断: NewExpression | 变量，在 getRecentEventListByEventAndServer 中保存 活动B 值，供当前逻辑读取或更新。 |
| 547 | tempEventList | const | getRecentEventListByEventAndServer | Array<Event> | 保存 临时活动列表，用于按顺序遍历或批量渲染。 |
| 548 | i | let | getRecentEventListByEventAndServer | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 549 | tempEvent | const | getRecentEventListByEventAndServer | 推断: NewExpression | 变量，在 getRecentEventListByEventAndServer 中保存 临时活动 值，供当前逻辑读取或更新。 |

### models/gacha.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 80 | constructor | constructor | Gacha | gachaId: number | - | 构造 Gacha 实例，并初始化该模型的本地基础字段。 |
| 102 | initFull | method | Gacha | useCache: boolean | 推断 | 在 Gacha 模型中加载远端完整详情并标记初始化状态。 |
| 144 | getData | method | Gacha | update: boolean | 推断 | 在 Gacha 模型中请求当前模型的远端详情数据。 |
| 157 | getBannerImage | method | Gacha | - | Promise<Image> | 在 Gacha 模型中获取横幅图片。 |
| 175 | getGachaBGImage | method | Gacha | displayedServerList: Server[] | Promise<Image> | 在 Gacha 模型中获取卡池背景图片。 |
| 199 | getGachaLogo | method | Gacha | displayedServerList: Server[] | Promise<Image> | 在 Gacha 模型中获取卡池Logo。 |
| 212 | getEventId | method | Gacha | - | 推断 | 在 Gacha 模型中获取活动ID。 |
| 228 | getTypeName | method | Gacha | - | 推断 | 在 Gacha 模型中获取类型名称。 |
| 237 | getGachaPickUpCardId | method | Gacha | - | 推断 | 在 Gacha 模型中获取卡池PickUp卡牌ID。 |
| 261 | getPresentGachaList | function | 模块顶层 | server: Server; start: number; end: number | Promise<Array<Gacha>> | 在BangDream 领域模型层中获取Present卡池列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 17 | gachaDataCache | const | 模块顶层 | 推断: ObjectLiteralExpression | 变量，在 模块顶层 中保存 卡池数据缓存 值，供当前逻辑读取或更新。 |
| 19 | typeName | const | 模块顶层 | Record<string, string> | 变量，在 模块顶层 中保存 类型名称 值，供当前逻辑读取或更新。 |
| 22 | gachaId | class-field | Gacha | number | 保存 卡池ID，用于定位对应业务实体。 |
| 23 | isExist | class-field | Gacha | 推断: FalseKeyword | 布尔标记，表示 isExist 的判断结果。 |
| 24 | data | class-field | Gacha | object | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 25 | resourceName | class-field | Gacha | string | 字段，在 Gacha 中保存 resource名称 值，供当前逻辑读取或更新。 |
| 26 | bannerAssetBundleName | class-field | Gacha | string | 字段，在 Gacha 中保存 横幅资源Bundle名称 值，供当前逻辑读取或更新。 |
| 27 | gachaName | class-field | Gacha | Array<string \| null> | 字段，在 Gacha 中保存 卡池名称 值，供当前逻辑读取或更新。 |
| 28 | publishedAt | class-field | Gacha | Array<number \| null> | 字段，在 Gacha 中保存 publishedAt 值，供当前逻辑读取或更新。 |
| 29 | closedAt | class-field | Gacha | Array<number \| null> | 字段，在 Gacha 中保存 closedAt 值，供当前逻辑读取或更新。 |
| 30 | type | class-field | Gacha | string | 字段，在 Gacha 中保存 类型 值，供当前逻辑读取或更新。 |
| 31 | newCards | class-field | Gacha | Array<number \| null> | 字段，在 Gacha 中保存 new卡牌列表 值，供当前逻辑读取或更新。 |
| 34 | details | class-field | Gacha | Array<{ [cardId: string]: { rarityIndex: number; weight: number; pickUp: boolean; }; } \| null> | 字段，在 Gacha 中保存 详情列表 值，供当前逻辑读取或更新。 |
| 36 | rarityIndex | type-field | Gacha | number | 字段，在 Gacha 中保存 rarity下标 值，供当前逻辑读取或更新。 |
| 37 | weight | type-field | Gacha | number | 字段，在 Gacha 中保存 weight 值，供当前逻辑读取或更新。 |
| 38 | pickUp | type-field | Gacha | boolean | 字段，在 Gacha 中保存 pickUp 值，供当前逻辑读取或更新。 |
| 41 | rates | class-field | Gacha | Array<{ [rarity: string]: { rate: number; weightTotal: number; }; }> | 字段，在 Gacha 中保存 概率列表 值，供当前逻辑读取或更新。 |
| 43 | rate | type-field | Gacha | number | 字段，在 Gacha 中保存 概率 值，供当前逻辑读取或更新。 |
| 44 | weightTotal | type-field | Gacha | number | 字段，在 Gacha 中保存 weightTotal 值，供当前逻辑读取或更新。 |
| 47 | paymentMethods | class-field | Gacha | Array<{ paymentMethod: string; gachaId: number; paymentType: string; quantity: number; paymentMethodId: number; count: number; behavior: string; pickup: boolean; maxSpinLimit: number; costItemQuantity: number; discountType: number; ticketId: number; }> | 字段，在 Gacha 中保存 paymentMethods 值，供当前逻辑读取或更新。 |
| 48 | paymentMethod | type-field | Gacha | string | 字段，在 Gacha 中保存 paymentMethod 值，供当前逻辑读取或更新。 |
| 49 | gachaId | type-field | Gacha | number | 保存 卡池ID，用于定位对应业务实体。 |
| 50 | paymentType | type-field | Gacha | string | 字段，在 Gacha 中保存 payment类型 值，供当前逻辑读取或更新。 |
| 51 | quantity | type-field | Gacha | number | 字段，在 Gacha 中保存 quantity 值，供当前逻辑读取或更新。 |
| 52 | paymentMethodId | type-field | Gacha | number | 保存 paymentMethodID，用于定位对应业务实体。 |
| 53 | count | type-field | Gacha | number | 字段，在 Gacha 中保存 数量 值，供当前逻辑读取或更新。 |
| 54 | behavior | type-field | Gacha | string | 字段，在 Gacha 中保存 behavior 值，供当前逻辑读取或更新。 |
| 55 | pickup | type-field | Gacha | boolean | 字段，在 Gacha 中保存 pickup 值，供当前逻辑读取或更新。 |
| 56 | maxSpinLimit | type-field | Gacha | number | 字段，在 Gacha 中保存 最大值SpinLimit 值，供当前逻辑读取或更新。 |
| 57 | costItemQuantity | type-field | Gacha | number | 字段，在 Gacha 中保存 cost道具Quantity 值，供当前逻辑读取或更新。 |
| 58 | discountType | type-field | Gacha | number | 字段，在 Gacha 中保存 discount类型 值，供当前逻辑读取或更新。 |
| 59 | ticketId | type-field | Gacha | number | 保存 ticketID，用于定位对应业务实体。 |
| 61 | description | class-field | Gacha | Array<string \| null> | 字段，在 Gacha 中保存 description 值，供当前逻辑读取或更新。 |
| 62 | annotation | class-field | Gacha | Array<string \| null> | 字段，在 Gacha 中保存 annotation 值，供当前逻辑读取或更新。 |
| 63 | gachaPeriod | class-field | Gacha | Array<string \| null> | 字段，在 Gacha 中保存 卡池Period 值，供当前逻辑读取或更新。 |
| 64 | gachaType | class-field | Gacha | string | 字段，在 Gacha 中保存 卡池类型 值，供当前逻辑读取或更新。 |
| 65 | information | class-field | Gacha | { description: Array<string \| null>; term: Array<string \| null>; newMemberInfo: Array<string \| null>; notice: Array<string \| null>; } | 字段，在 Gacha 中保存 information 值，供当前逻辑读取或更新。 |
| 66 | description | type-field | Gacha | Array<string \| null> | 字段，在 Gacha 中保存 description 值，供当前逻辑读取或更新。 |
| 67 | term | type-field | Gacha | Array<string \| null> | 字段，在 Gacha 中保存 term 值，供当前逻辑读取或更新。 |
| 68 | newMemberInfo | type-field | Gacha | Array<string \| null> | 字段，在 Gacha 中保存 newMemberInfo 值，供当前逻辑读取或更新。 |
| 69 | notice | type-field | Gacha | Array<string \| null> | 字段，在 Gacha 中保存 notice 值，供当前逻辑读取或更新。 |
| 72 | pickUpCardId | class-field | Gacha | Array<number> | 保存 pickUp卡牌ID，用于定位对应业务实体。 |
| 73 | isInitFull | class-field | Gacha | 推断: FalseKeyword | 布尔标记，表示 isInitFull 的判断结果。 |
| 82 | gachaData | const | Gacha | 推断: ElementAccessExpression | 变量，在 Gacha 中保存 卡池数据 值，供当前逻辑读取或更新。 |
| 109 | gachaData | let | initFull | object | 变量，在 initFull 中保存 卡池数据 值，供当前逻辑读取或更新。 |
| 145 | time | const | getData | 推断: ConditionalExpression | 变量，在 getData 中保存 时间 值，供当前逻辑读取或更新。 |
| 146 | gachaData | const | getData | 推断: AwaitExpression | 变量，在 getData 中保存 卡池数据 值，供当前逻辑读取或更新。 |
| 160 | BannerImageBuffer | const | getBannerImage | 推断: AwaitExpression | 保存 横幅图片缓冲区，用于二进制资源处理。 |
| 179 | server | const | getGachaBGImage | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 180 | BGImageBuffer | let | getGachaBGImage | Buffer | 保存 BG图片缓冲区，用于二进制资源处理。 |
| 203 | server | const | getGachaLogo | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 204 | LogoImageBuffer | const | getGachaLogo | 推断: AwaitExpression | 保存 Logo图片缓冲区，用于二进制资源处理。 |
| 213 | eventList | const | getEventId | Array<number> | 保存 活动列表，用于按顺序遍历或批量渲染。 |
| 214 | i | let | getEventId | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 215 | server | const | getEventId | 推断: ElementAccessExpression | 保存当前目标服务器枚举或服务器代码。 |
| 216 | tempEvent | const | getEventId | 推断: CallExpression | 变量，在 getEventId 中保存 临时活动 值，供当前逻辑读取或更新。 |
| 239 | server | const | getGachaPickUpCardId | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 240 | details | const | getGachaPickUpCardId | 推断: ElementAccessExpression | 变量，在 getGachaPickUpCardId 中保存 详情列表 值，供当前逻辑读取或更新。 |
| 241 | i | const | getGachaPickUpCardId | 推断 | 保存循环下标或对象键。 |
| 243 | element | const | getGachaPickUpCardId | 推断: ElementAccessExpression | 变量，在 getGachaPickUpCardId 中保存 element 值，供当前逻辑读取或更新。 |
| 266 | gachaList | const | getPresentGachaList | Array<Gacha> | 保存 卡池列表，用于按顺序遍历或批量渲染。 |
| 267 | gachaListMain | const | getPresentGachaList | 推断: ElementAccessExpression | 变量，在 getPresentGachaList 中保存 卡池列表主数据 值，供当前逻辑读取或更新。 |
| 269 | gachaId | const | getPresentGachaList | 推断 | 保存 卡池ID，用于定位对应业务实体。 |
| 271 | gacha | const | getPresentGachaList | 推断: NewExpression | 保存当前卡池领域模型实例。 |

### models/item.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 27 | constructor | constructor | Item | itemId: string | - | 构造 Item 实例，并初始化该模型的本地基础字段。 |
| 76 | getItemImage | method | Item | server: Server; displayedServerList: Server[] | Promise<Image> | 在 Item 模型中获取道具图片。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 16 | name | class-field | Item | Array<string \| null> | 字段，在 Item 中保存 名称 值，供当前逻辑读取或更新。 |
| 17 | resourceId | class-field | Item | number | 保存 resourceID，用于定位对应业务实体。 |
| 18 | itemId | class-field | Item | string | 保存 道具ID，用于定位对应业务实体。 |
| 19 | type | class-field | Item | string | 字段，在 Item 中保存 类型 值，供当前逻辑读取或更新。 |
| 20 | typeName | class-field | Item | string | 字段，在 Item 中保存 类型名称 值，供当前逻辑读取或更新。 |
| 21 | isExist | class-field | Item | 推断: FalseKeyword | 布尔标记，表示 isExist 的判断结果。 |
| 54 | itemData | const | Item | 推断: ElementAccessExpression | 变量，在 Item 中保存 道具数据 值，供当前逻辑读取或更新。 |
| 62 | prefix | const | Item | 推断 | 变量，在 Item 中保存 prefix 值，供当前逻辑读取或更新。 |
| 62 | typeName | const | Item | 推断 | 变量，在 Item 中保存 类型名称 值，供当前逻辑读取或更新。 |
| 85 | itemImageBuffer | let | getItemImage | Buffer | 保存 道具图片缓冲区，用于二进制资源处理。 |

### models/main-data-store.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | loadMainAPI | function | 模块顶层 | useCache: boolean | 推断 | 在BangDream 领域模型层中加载主数据API。 |
| 22 | <anonymous> | callback | promiseAll | key: 推断 | 推断 | 作为 \`Object.keys(bestdoriApiPath).map\` 的回调，处理 key。 |
| 77 | <anonymous> | callback | 模块顶层 | - | 推断 | 作为 \`loadMainAPI(true).then\` 的回调，处理 当前值。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 12 | mainAPI | const | 模块顶层 | object | 变量，在 模块顶层 中保存 主数据API 值，供当前逻辑读取或更新。 |
| 22 | promiseAll | const | loadMainAPI | 推断: CallExpression | 变量，在 loadMainAPI 中保存 异步任务All 值，供当前逻辑读取或更新。 |
| 41 | cardsCnFix | const | loadMainAPI | 推断: AwaitExpression | 变量，在 loadMainAPI 中保存 卡牌列表CnFix 值，供当前逻辑读取或更新。 |
| 42 | key | const | loadMainAPI | 推断 | 变量，在 loadMainAPI 中保存 key 值，供当前逻辑读取或更新。 |
| 45 | skillsCnFix | const | loadMainAPI | 推断: AwaitExpression | 变量，在 loadMainAPI 中保存 技能列表CnFix 值，供当前逻辑读取或更新。 |
| 48 | key | const | loadMainAPI | 推断 | 变量，在 loadMainAPI 中保存 key 值，供当前逻辑读取或更新。 |
| 51 | areaItemFix | const | loadMainAPI | 推断: AwaitExpression | 变量，在 loadMainAPI 中保存 区域道具Fix 值，供当前逻辑读取或更新。 |
| 54 | key | const | loadMainAPI | 推断 | 变量，在 loadMainAPI 中保存 key 值，供当前逻辑读取或更新。 |
| 60 | songNickname | const | loadMainAPI | 推断: AwaitExpression | 变量，在 loadMainAPI 中保存 歌曲Nickname 值，供当前逻辑读取或更新。 |
| 63 | i | let | loadMainAPI | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 64 | element | const | loadMainAPI | 推断: ElementAccessExpression | 变量，在 loadMainAPI 中保存 element 值，供当前逻辑读取或更新。 |

### models/player.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 189 | constructor | constructor | Player | playerId: number; server: Server | - | 构造 Player 实例，并初始化该模型的本地基础字段。 |
| 199 | initFull | method | Player | useCache: boolean; mode: 0 \| 1 \| 2 \| 3 | 推断 | 在 Player 模型中加载远端完整详情并标记初始化状态。 |
| 218 | <anonymous> | callback | initFull | err: 推断 | 推断 | 作为 \`callAPIAndCacheResponse( \`${bestdoriUrl}/api/player/${Server[this.server]}/${this.playerId}?mode=${mode}\`, 300, 1, ).catch\` 的回调，处理 err。 |
| 304 | calcStat | method | Player | event: Event | Promise<Stat> | 在 Player 模型中计算数值。 |
| 430 | calcHSR | method | Player | - | number | 在 Player 模型中计算HSR。 |
| 449 | getUserIllustration | method | Player | - | { cardId: number; trainingStatus: boolean } | 在 Player 模型中获取UserIllustration。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 22 | playerId | class-field | Player | number | 保存 玩家ID，用于定位对应业务实体。 |
| 23 | isExist | class-field | Player | boolean | 布尔标记，表示 isExist 的判断结果。 |
| 24 | initError | class-field | Player | boolean | 字段，在 Player 中保存 init错误对象 值，供当前逻辑读取或更新。 |
| 25 | cache | class-field | Player | boolean | 字段，在 Player 中保存 缓存 值，供当前逻辑读取或更新。 |
| 26 | time | class-field | Player | number | 字段，在 Player 中保存 时间 值，供当前逻辑读取或更新。 |
| 27 | profile | class-field | Player | { userId: string; userName: string; rank: number; degree: number; introduction: string; publishTotalDeckPowerFlg: boolean; publishBandRankFlg: boolean; publishMusicClearedFlg: boolean; publishMusicFullComboFlg: boolean; publishHighScoreRatingFlg: boolean; publishUserIdFlg: boolean; searchableFlg: boolean; publishUpdatedAtFlg: boolean; friendApplicableFlg: boolean; publishMusicAllPerfectFlg: boolean; publishDeckRankFlg: boolean; publishStageChallengeAchievementConditionsFlg: boolean; publishStageChallengeFriendRankingFlg: boolean; publishCharacterRankFlg: boolean; mainDeckUserSituations: { entries: Array<{ userId: string; situationId: number; level: number; exp: number; createdAt: string; addExp: number; trainingStatus: 'not_doing' \| 'done'; duplicateCount: number; illust: 'after_training' \| 'normal'; skillExp: number; skillLevel: number; userAppendParameter: { userId: string; situationId: number; performance: number; technique: number; visual: number; characterPotentialPerformance: number; characterPotentialTechnique: number; characterPotentialVisual: number; characterBonusPerformance?: number; characterBonusTechnique?: number; characterBonusVisual?: number; }; limitBreakRank: number; }>; }; enabledUserAreaItems: { entries: Array<{ userId: string; areaItemId: number; areaItemCategory: number; level: number; }>; }; bandRankMap: { entries: { [bandId: number]: number; }; }; userHighScoreRating: { [bandHighScoreRatingName: string]: { entries: Array<{ musicId: number; difficulty: string; rating: number; }>; }; }; mainUserDeck: { deckId: number; deckName: string; leader: number; member1: number; member2: number; member3: number; member4: number; deckType: string; }; userProfileSituation: { userId: string; situationId: number; illust: 'after_training' \| 'normal'; viewProfileSituationStatus: 'deck_leader' \| 'profile_situation'; }; userProfileDegreeMap: { entries: { first: { userId: string; profileDegreeType: string; degreeId: number; }; second: { userId: string; profileDegreeType: string; degreeId: number; }; }; }; userTwitter?: { twitterId: string; twitterName: string; screenName: string; url: string; profileImageUrl: string; }; userDeckTotalRatingMap: { entries: { [bandId: number]: { rank: string; score: number; level: number; lowerRating: number; upperRating: number; }; }; }; stageChallengeAchievementConditionsMap: { entries: { [bandId: number]: number; }; }; userMusicClearInfoMap: { entries: { [difficultyName: string]: { clearedMusicCount: number; fullComboMusicCount: number; allPerfectMusicCount: number; }; }; }; userCharacterRankMap: { entries: { [characterId: number]: { rank: number; exp: number; addExp: number; nextExp: number; totalExp: number; releasedPotentialLevel: number; }; }; }; //其他 //卡牌列表 cardList: Card[]; //插画 userIllustration: { cardId: number; trainingStatus: boolean }; } | 字段，在 Player 中保存 profile 值，供当前逻辑读取或更新。 |
| 28 | userId | type-field | Player | string | 保存 userID，用于定位对应业务实体。 |
| 29 | userName | type-field | Player | string | 字段，在 Player 中保存 user名称 值，供当前逻辑读取或更新。 |
| 30 | rank | type-field | Player | number | 字段，在 Player 中保存 rank 值，供当前逻辑读取或更新。 |
| 31 | degree | type-field | Player | number | 字段，在 Player 中保存 称号 值，供当前逻辑读取或更新。 |
| 32 | introduction | type-field | Player | string | 字段，在 Player 中保存 introduction 值，供当前逻辑读取或更新。 |
| 33 | publishTotalDeckPowerFlg | type-field | Player | boolean | 字段，在 Player 中保存 publishTotalDeckPowerFlg 值，供当前逻辑读取或更新。 |
| 34 | publishBandRankFlg | type-field | Player | boolean | 字段，在 Player 中保存 publish乐队RankFlg 值，供当前逻辑读取或更新。 |
| 35 | publishMusicClearedFlg | type-field | Player | boolean | 字段，在 Player 中保存 publish音乐ClearedFlg 值，供当前逻辑读取或更新。 |
| 36 | publishMusicFullComboFlg | type-field | Player | boolean | 字段，在 Player 中保存 publish音乐FullComboFlg 值，供当前逻辑读取或更新。 |
| 37 | publishHighScoreRatingFlg | type-field | Player | boolean | 字段，在 Player 中保存 publishHigh分数RatingFlg 值，供当前逻辑读取或更新。 |
| 38 | publishUserIdFlg | type-field | Player | boolean | 字段，在 Player 中保存 publishUserIDFlg 值，供当前逻辑读取或更新。 |
| 39 | searchableFlg | type-field | Player | boolean | 字段，在 Player 中保存 searchableFlg 值，供当前逻辑读取或更新。 |
| 40 | publishUpdatedAtFlg | type-field | Player | boolean | 字段，在 Player 中保存 publishUpdatedAtFlg 值，供当前逻辑读取或更新。 |
| 41 | friendApplicableFlg | type-field | Player | boolean | 字段，在 Player 中保存 friendApplicableFlg 值，供当前逻辑读取或更新。 |
| 42 | publishMusicAllPerfectFlg | type-field | Player | boolean | 字段，在 Player 中保存 publish音乐AllPerfectFlg 值，供当前逻辑读取或更新。 |
| 43 | publishDeckRankFlg | type-field | Player | boolean | 字段，在 Player 中保存 publishDeckRankFlg 值，供当前逻辑读取或更新。 |
| 44 | publishStageChallengeAchievementConditionsFlg | type-field | Player | boolean | 字段，在 Player 中保存 publish试炼ChallengeAchievementConditionsFlg 值，供当前逻辑读取或更新。 |
| 45 | publishStageChallengeFriendRankingFlg | type-field | Player | boolean | 字段，在 Player 中保存 publish试炼ChallengeFriendRankingFlg 值，供当前逻辑读取或更新。 |
| 46 | publishCharacterRankFlg | type-field | Player | boolean | 字段，在 Player 中保存 publish角色RankFlg 值，供当前逻辑读取或更新。 |
| 47 | mainDeckUserSituations | type-field | Player | { entries: Array<{ userId: string; situationId: number; level: number; exp: number; createdAt: string; addExp: number; trainingStatus: 'not_doing' \| 'done'; duplicateCount: number; illust: 'after_training' \| 'normal'; skillExp: number; skillLevel: number; userAppendParameter: { userId: string; situationId: number; performance: number; technique: number; visual: number; characterPotentialPerformance: number; characterPotentialTechnique: number; characterPotentialVisual: number; characterBonusPerformance?: number; characterBonusTechnique?: number; characterBonusVisual?: number; }; limitBreakRank: number; }>; } | 字段，在 Player 中保存 主数据DeckUserSituations 值，供当前逻辑读取或更新。 |
| 48 | entries | type-field | Player | Array<{ userId: string; situationId: number; level: number; exp: number; createdAt: string; addExp: number; trainingStatus: 'not_doing' \| 'done'; duplicateCount: number; illust: 'after_training' \| 'normal'; skillExp: number; skillLevel: number; userAppendParameter: { userId: string; situationId: number; performance: number; technique: number; visual: number; characterPotentialPerformance: number; characterPotentialTechnique: number; characterPotentialVisual: number; characterBonusPerformance?: number; characterBonusTechnique?: number; characterBonusVisual?: number; }; limitBreakRank: number; }> | 字段，在 Player 中保存 entries 值，供当前逻辑读取或更新。 |
| 49 | userId | type-field | Player | string | 保存 userID，用于定位对应业务实体。 |
| 50 | situationId | type-field | Player | number | 保存 situationID，用于定位对应业务实体。 |
| 51 | level | type-field | Player | number | 字段，在 Player 中保存 等级 值，供当前逻辑读取或更新。 |
| 52 | exp | type-field | Player | number | 字段，在 Player 中保存 exp 值，供当前逻辑读取或更新。 |
| 53 | createdAt | type-field | Player | string | 字段，在 Player 中保存 createdAt 值，供当前逻辑读取或更新。 |
| 54 | addExp | type-field | Player | number | 字段，在 Player 中保存 addExp 值，供当前逻辑读取或更新。 |
| 55 | trainingStatus | type-field | Player | 'not_doing' \| 'done' | 字段，在 Player 中保存 training状态 值，供当前逻辑读取或更新。 |
| 56 | duplicateCount | type-field | Player | number | 字段，在 Player 中保存 duplicate数量 值，供当前逻辑读取或更新。 |
| 57 | illust | type-field | Player | 'after_training' \| 'normal' | 字段，在 Player 中保存 illust 值，供当前逻辑读取或更新。 |
| 58 | skillExp | type-field | Player | number | 字段，在 Player 中保存 技能Exp 值，供当前逻辑读取或更新。 |
| 59 | skillLevel | type-field | Player | number | 字段，在 Player 中保存 技能等级 值，供当前逻辑读取或更新。 |
| 60 | userAppendParameter | type-field | Player | { userId: string; situationId: number; performance: number; technique: number; visual: number; characterPotentialPerformance: number; characterPotentialTechnique: number; characterPotentialVisual: number; characterBonusPerformance?: number; characterBonusTechnique?: number; characterBonusVisual?: number; } | 字段，在 Player 中保存 userAppendParameter 值，供当前逻辑读取或更新。 |
| 61 | userId | type-field | Player | string | 保存 userID，用于定位对应业务实体。 |
| 62 | situationId | type-field | Player | number | 保存 situationID，用于定位对应业务实体。 |
| 63 | performance | type-field | Player | number | 字段，在 Player 中保存 performance 值，供当前逻辑读取或更新。 |
| 64 | technique | type-field | Player | number | 字段，在 Player 中保存 technique 值，供当前逻辑读取或更新。 |
| 65 | visual | type-field | Player | number | 字段，在 Player 中保存 visual 值，供当前逻辑读取或更新。 |
| 66 | characterPotentialPerformance | type-field | Player | number | 字段，在 Player 中保存 角色PotentialPerformance 值，供当前逻辑读取或更新。 |
| 67 | characterPotentialTechnique | type-field | Player | number | 字段，在 Player 中保存 角色PotentialTechnique 值，供当前逻辑读取或更新。 |
| 68 | characterPotentialVisual | type-field | Player | number | 字段，在 Player 中保存 角色PotentialVisual 值，供当前逻辑读取或更新。 |
| 69 | characterBonusPerformance | type-field | Player | number | 字段，在 Player 中保存 角色加成Performance 值，供当前逻辑读取或更新。 |
| 70 | characterBonusTechnique | type-field | Player | number | 字段，在 Player 中保存 角色加成Technique 值，供当前逻辑读取或更新。 |
| 71 | characterBonusVisual | type-field | Player | number | 字段，在 Player 中保存 角色加成Visual 值，供当前逻辑读取或更新。 |
| 73 | limitBreakRank | type-field | Player | number | 字段，在 Player 中保存 limitBreakRank 值，供当前逻辑读取或更新。 |
| 76 | enabledUserAreaItems | type-field | Player | { entries: Array<{ userId: string; areaItemId: number; areaItemCategory: number; level: number; }>; } | 字段，在 Player 中保存 enabledUser区域道具列表 值，供当前逻辑读取或更新。 |
| 77 | entries | type-field | Player | Array<{ userId: string; areaItemId: number; areaItemCategory: number; level: number; }> | 字段，在 Player 中保存 entries 值，供当前逻辑读取或更新。 |
| 78 | userId | type-field | Player | string | 保存 userID，用于定位对应业务实体。 |
| 79 | areaItemId | type-field | Player | number | 保存 区域道具ID，用于定位对应业务实体。 |
| 80 | areaItemCategory | type-field | Player | number | 字段，在 Player 中保存 区域道具Category 值，供当前逻辑读取或更新。 |
| 81 | level | type-field | Player | number | 字段，在 Player 中保存 等级 值，供当前逻辑读取或更新。 |
| 84 | bandRankMap | type-field | Player | { entries: { [bandId: number]: number; }; } | 保存 乐队Rank映射 映射，用于按键快速查找。 |
| 85 | entries | type-field | Player | { [bandId: number]: number; } | 字段，在 Player 中保存 entries 值，供当前逻辑读取或更新。 |
| 89 | userHighScoreRating | type-field | Player | { [bandHighScoreRatingName: string]: { entries: Array<{ musicId: number; difficulty: string; rating: number; }>; }; } | 字段，在 Player 中保存 userHigh分数Rating 值，供当前逻辑读取或更新。 |
| 91 | entries | type-field | Player | Array<{ musicId: number; difficulty: string; rating: number; }> | 字段，在 Player 中保存 entries 值，供当前逻辑读取或更新。 |
| 92 | musicId | type-field | Player | number | 保存 音乐ID，用于定位对应业务实体。 |
| 93 | difficulty | type-field | Player | string | 字段，在 Player 中保存 难度 值，供当前逻辑读取或更新。 |
| 94 | rating | type-field | Player | number | 字段，在 Player 中保存 rating 值，供当前逻辑读取或更新。 |
| 98 | mainUserDeck | type-field | Player | { deckId: number; deckName: string; leader: number; member1: number; member2: number; member3: number; member4: number; deckType: string; } | 字段，在 Player 中保存 主数据UserDeck 值，供当前逻辑读取或更新。 |
| 99 | deckId | type-field | Player | number | 保存 deckID，用于定位对应业务实体。 |
| 100 | deckName | type-field | Player | string | 字段，在 Player 中保存 deck名称 值，供当前逻辑读取或更新。 |
| 101 | leader | type-field | Player | number | 字段，在 Player 中保存 leader 值，供当前逻辑读取或更新。 |
| 102 | member1 | type-field | Player | number | 字段，在 Player 中保存 member1 值，供当前逻辑读取或更新。 |
| 103 | member2 | type-field | Player | number | 字段，在 Player 中保存 member2 值，供当前逻辑读取或更新。 |
| 104 | member3 | type-field | Player | number | 字段，在 Player 中保存 member3 值，供当前逻辑读取或更新。 |
| 105 | member4 | type-field | Player | number | 字段，在 Player 中保存 member4 值，供当前逻辑读取或更新。 |
| 106 | deckType | type-field | Player | string | 字段，在 Player 中保存 deck类型 值，供当前逻辑读取或更新。 |
| 108 | userProfileSituation | type-field | Player | { userId: string; situationId: number; illust: 'after_training' \| 'normal'; viewProfileSituationStatus: 'deck_leader' \| 'profile_situation'; } | 字段，在 Player 中保存 userProfileSituation 值，供当前逻辑读取或更新。 |
| 109 | userId | type-field | Player | string | 保存 userID，用于定位对应业务实体。 |
| 110 | situationId | type-field | Player | number | 保存 situationID，用于定位对应业务实体。 |
| 111 | illust | type-field | Player | 'after_training' \| 'normal' | 字段，在 Player 中保存 illust 值，供当前逻辑读取或更新。 |
| 112 | viewProfileSituationStatus | type-field | Player | 'deck_leader' \| 'profile_situation' | 字段，在 Player 中保存 viewProfileSituation状态 值，供当前逻辑读取或更新。 |
| 114 | userProfileDegreeMap | type-field | Player | { entries: { first: { userId: string; profileDegreeType: string; degreeId: number; }; second: { userId: string; profileDegreeType: string; degreeId: number; }; }; } | 保存 userProfile称号映射 映射，用于按键快速查找。 |
| 115 | entries | type-field | Player | { first: { userId: string; profileDegreeType: string; degreeId: number; }; second: { userId: string; profileDegreeType: string; degreeId: number; }; } | 字段，在 Player 中保存 entries 值，供当前逻辑读取或更新。 |
| 116 | first | type-field | Player | { userId: string; profileDegreeType: string; degreeId: number; } | 字段，在 Player 中保存 first 值，供当前逻辑读取或更新。 |
| 117 | userId | type-field | Player | string | 保存 userID，用于定位对应业务实体。 |
| 118 | profileDegreeType | type-field | Player | string | 字段，在 Player 中保存 profile称号类型 值，供当前逻辑读取或更新。 |
| 119 | degreeId | type-field | Player | number | 保存 称号ID，用于定位对应业务实体。 |
| 121 | second | type-field | Player | { userId: string; profileDegreeType: string; degreeId: number; } | 字段，在 Player 中保存 second 值，供当前逻辑读取或更新。 |
| 122 | userId | type-field | Player | string | 保存 userID，用于定位对应业务实体。 |
| 123 | profileDegreeType | type-field | Player | string | 字段，在 Player 中保存 profile称号类型 值，供当前逻辑读取或更新。 |
| 124 | degreeId | type-field | Player | number | 保存 称号ID，用于定位对应业务实体。 |
| 128 | userTwitter | type-field | Player | { twitterId: string; twitterName: string; screenName: string; url: string; profileImageUrl: string; } | 字段，在 Player 中保存 userTwitter 值，供当前逻辑读取或更新。 |
| 129 | twitterId | type-field | Player | string | 保存 twitterID，用于定位对应业务实体。 |
| 130 | twitterName | type-field | Player | string | 字段，在 Player 中保存 twitter名称 值，供当前逻辑读取或更新。 |
| 131 | screenName | type-field | Player | string | 字段，在 Player 中保存 screen名称 值，供当前逻辑读取或更新。 |
| 132 | url | type-field | Player | string | 保存远端接口或资源下载地址。 |
| 133 | profileImageUrl | type-field | Player | string | 保存 profile图片URL，用于请求接口或下载资源。 |
| 135 | userDeckTotalRatingMap | type-field | Player | { entries: { [bandId: number]: { rank: string; score: number; level: number; lowerRating: number; upperRating: number; }; }; } | 保存 userDeckTotalRating映射 映射，用于按键快速查找。 |
| 136 | entries | type-field | Player | { [bandId: number]: { rank: string; score: number; level: number; lowerRating: number; upperRating: number; }; } | 字段，在 Player 中保存 entries 值，供当前逻辑读取或更新。 |
| 138 | rank | type-field | Player | string | 字段，在 Player 中保存 rank 值，供当前逻辑读取或更新。 |
| 139 | score | type-field | Player | number | 字段，在 Player 中保存 分数 值，供当前逻辑读取或更新。 |
| 140 | level | type-field | Player | number | 字段，在 Player 中保存 等级 值，供当前逻辑读取或更新。 |
| 141 | lowerRating | type-field | Player | number | 字段，在 Player 中保存 lowerRating 值，供当前逻辑读取或更新。 |
| 142 | upperRating | type-field | Player | number | 字段，在 Player 中保存 upperRating 值，供当前逻辑读取或更新。 |
| 146 | stageChallengeAchievementConditionsMap | type-field | Player | { entries: { [bandId: number]: number; }; } | 保存 试炼ChallengeAchievementConditions映射 映射，用于按键快速查找。 |
| 147 | entries | type-field | Player | { [bandId: number]: number; } | 字段，在 Player 中保存 entries 值，供当前逻辑读取或更新。 |
| 151 | userMusicClearInfoMap | type-field | Player | { entries: { [difficultyName: string]: { clearedMusicCount: number; fullComboMusicCount: number; allPerfectMusicCount: number; }; }; } | 保存 user音乐ClearInfo映射 映射，用于按键快速查找。 |
| 152 | entries | type-field | Player | { [difficultyName: string]: { clearedMusicCount: number; fullComboMusicCount: number; allPerfectMusicCount: number; }; } | 字段，在 Player 中保存 entries 值，供当前逻辑读取或更新。 |
| 154 | clearedMusicCount | type-field | Player | number | 字段，在 Player 中保存 cleared音乐数量 值，供当前逻辑读取或更新。 |
| 155 | fullComboMusicCount | type-field | Player | number | 字段，在 Player 中保存 fullCombo音乐数量 值，供当前逻辑读取或更新。 |
| 156 | allPerfectMusicCount | type-field | Player | number | 字段，在 Player 中保存 allPerfect音乐数量 值，供当前逻辑读取或更新。 |
| 160 | userCharacterRankMap | type-field | Player | { entries: { [characterId: number]: { rank: number; exp: number; addExp: number; nextExp: number; totalExp: number; releasedPotentialLevel: number; }; }; } | 保存 user角色Rank映射 映射，用于按键快速查找。 |
| 161 | entries | type-field | Player | { [characterId: number]: { rank: number; exp: number; addExp: number; nextExp: number; totalExp: number; releasedPotentialLevel: number; }; } | 字段，在 Player 中保存 entries 值，供当前逻辑读取或更新。 |
| 163 | rank | type-field | Player | number | 字段，在 Player 中保存 rank 值，供当前逻辑读取或更新。 |
| 164 | exp | type-field | Player | number | 字段，在 Player 中保存 exp 值，供当前逻辑读取或更新。 |
| 165 | addExp | type-field | Player | number | 字段，在 Player 中保存 addExp 值，供当前逻辑读取或更新。 |
| 166 | nextExp | type-field | Player | number | 字段，在 Player 中保存 后一项Exp 值，供当前逻辑读取或更新。 |
| 167 | totalExp | type-field | Player | number | 字段，在 Player 中保存 totalExp 值，供当前逻辑读取或更新。 |
| 168 | releasedPotentialLevel | type-field | Player | number | 字段，在 Player 中保存 releasedPotential等级 值，供当前逻辑读取或更新。 |
| 175 | cardList | type-field | Player | Card[] | 保存 卡牌列表，用于按顺序遍历或批量渲染。 |
| 177 | userIllustration | type-field | Player | { cardId: number; trainingStatus: boolean } | 字段，在 Player 中保存 userIllustration 值，供当前逻辑读取或更新。 |
| 177 | cardId | type-field | Player | number | 保存 卡牌ID，用于定位对应业务实体。 |
| 177 | trainingStatus | type-field | Player | boolean | 字段，在 Player 中保存 training状态 值，供当前逻辑读取或更新。 |
| 179 | server | class-field | Player | Server | 保存当前目标服务器枚举或服务器代码。 |
| 181 | isInitfull | class-field | Player | boolean | 布尔标记，表示 isInitfull 的判断结果。 |
| 203 | cacheTime | const | initFull | 推断: ConditionalExpression | 变量，在 initFull 中保存 缓存时间 值，供当前逻辑读取或更新。 |
| 205 | playerData | let | initFull | 推断 | 变量，在 initFull 中保存 玩家数据 值，供当前逻辑读取或更新。 |
| 239 | i | let | initFull | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 243 | cardData | const | initFull | 推断: ElementAccessExpression | 变量，在 initFull 中保存 卡牌数据 值，供当前逻辑读取或更新。 |
| 244 | card | const | initFull | 推断: NewExpression | 保存当前卡牌领域模型实例。 |
| 253 | i | let | initFull | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 254 | difficultyName | const | initFull | 推断: ElementAccessExpression | 变量，在 initFull 中保存 难度名称 值，供当前逻辑读取或更新。 |
| 262 | i | let | initFull | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 263 | difficultyName | const | initFull | 推断: ElementAccessExpression | 变量，在 initFull 中保存 难度名称 值，供当前逻辑读取或更新。 |
| 264 | number | const | initFull | 推断: BinaryExpression | 变量，在 initFull 中保存 数字 值，供当前逻辑读取或更新。 |
| 273 | i | let | initFull | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 274 | difficultyName | const | initFull | 推断: ElementAccessExpression | 变量，在 initFull 中保存 难度名称 值，供当前逻辑读取或更新。 |
| 275 | number | const | initFull | 推断: BinaryExpression | 变量，在 initFull 中保存 数字 值，供当前逻辑读取或更新。 |
| 284 | i | let | initFull | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 285 | difficultyName | const | initFull | 推断: ElementAccessExpression | 变量，在 initFull 中保存 难度名称 值，供当前逻辑读取或更新。 |
| 286 | number | const | initFull | 推断: BinaryExpression | 变量，在 initFull 中保存 数字 值，供当前逻辑读取或更新。 |
| 313 | cardDataList | const | calcStat | 推断: PropertyAccessExpression | 保存 卡牌数据列表，用于按顺序遍历或批量渲染。 |
| 314 | cardStatList | const | calcStat | 推断: ArrayLiteralExpression | 保存 卡牌数值列表，用于按顺序遍历或批量渲染。 |
| 315 | cardStat | const | calcStat | Stat | 变量，在 calcStat 中保存 卡牌数值 值，供当前逻辑读取或更新。 |
| 321 | i | let | calcStat | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 322 | cardData | const | calcStat | 推断: ElementAccessExpression | 变量，在 calcStat 中保存 卡牌数据 值，供当前逻辑读取或更新。 |
| 323 | card | const | calcStat | 推断: NewExpression | 保存当前卡牌领域模型实例。 |
| 324 | tempStat | const | calcStat | 推断: AwaitExpression | 变量，在 calcStat 中保存 临时数值 值，供当前逻辑读取或更新。 |
| 329 | extraStat | const | calcStat | Stat | 变量，在 calcStat 中保存 extra数值 值，供当前逻辑读取或更新。 |
| 335 | areaItemList | const | calcStat | 推断: PropertyAccessExpression | 保存 区域道具列表，用于按顺序遍历或批量渲染。 |
| 336 | i | let | calcStat | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 337 | element | const | calcStat | 推断: ElementAccessExpression | 变量，在 calcStat 中保存 element 值，供当前逻辑读取或更新。 |
| 338 | areaItem | const | calcStat | 推断: NewExpression | 变量，在 calcStat 中保存 区域道具 值，供当前逻辑读取或更新。 |
| 339 | areaItemLevel | const | calcStat | 推断: PropertyAccessExpression | 变量，在 calcStat 中保存 区域道具等级 值，供当前逻辑读取或更新。 |
| 340 | j | let | calcStat | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 341 | cardStat | const | calcStat | 推断: ElementAccessExpression | 变量，在 calcStat 中保存 卡牌数值 值，供当前逻辑读取或更新。 |
| 342 | card | const | calcStat | 推断: ElementAccessExpression | 保存当前卡牌领域模型实例。 |
| 343 | tempStat | const | calcStat | 推断: CallExpression | 变量，在 calcStat 中保存 临时数值 值，供当前逻辑读取或更新。 |
| 352 | eventStat | const | calcStat | Stat | 变量，在 calcStat 中保存 活动数值 值，供当前逻辑读取或更新。 |
| 359 | i | let | calcStat | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 360 | cardStat | const | calcStat | 推断: ElementAccessExpression | 变量，在 calcStat 中保存 卡牌数值 值，供当前逻辑读取或更新。 |
| 361 | card | const | calcStat | 推断: ElementAccessExpression | 保存当前卡牌领域模型实例。 |
| 362 | isCharacter | let | calcStat | 推断: FalseKeyword | 布尔标记，表示 is角色 的判断结果。 |
| 363 | isAttribute | let | calcStat | 推断: FalseKeyword | 布尔标记，表示 is属性 的判断结果。 |
| 364 | j | let | calcStat | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 365 | characterPercent | const | calcStat | 推断: ElementAccessExpression | 变量，在 calcStat 中保存 角色Percent 值，供当前逻辑读取或更新。 |
| 367 | tempStat | const | calcStat | 推断: ObjectLiteralExpression | 变量，在 calcStat 中保存 临时数值 值，供当前逻辑读取或更新。 |
| 377 | j | let | calcStat | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 378 | attributePercent | const | calcStat | 推断: ElementAccessExpression | 变量，在 calcStat 中保存 属性Percent 值，供当前逻辑读取或更新。 |
| 380 | tempStat | const | calcStat | 推断: ObjectLiteralExpression | 变量，在 calcStat 中保存 临时数值 值，供当前逻辑读取或更新。 |
| 396 | tempStat | const | calcStat | 推断: ObjectLiteralExpression | 变量，在 calcStat 中保存 临时数值 值，供当前逻辑读取或更新。 |
| 431 | hsr | let | calcHSR | 推断: FirstLiteralToken | 变量，在 calcHSR 中保存 hsr 值，供当前逻辑读取或更新。 |
| 432 | userHighScoreRating | const | calcHSR | 推断: PropertyAccessExpression | 变量，在 calcHSR 中保存 userHigh分数Rating 值，供当前逻辑读取或更新。 |
| 433 | i | const | calcHSR | 推断 | 保存循环下标或对象键。 |
| 435 | userBandHighScoreRating | const | calcHSR | 推断: PropertyAccessExpression | 变量，在 calcHSR 中保存 user乐队High分数Rating 值，供当前逻辑读取或更新。 |
| 436 | j | let | calcHSR | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 437 | element | const | calcHSR | 推断: ElementAccessExpression | 变量，在 calcHSR 中保存 element 值，供当前逻辑读取或更新。 |
| 449 | cardId | type-field | getUserIllustration | number | 保存 卡牌ID，用于定位对应业务实体。 |
| 449 | trainingStatus | type-field | getUserIllustration | boolean | 字段，在 getUserIllustration 中保存 training状态 值，供当前逻辑读取或更新。 |
| 450 | illustrationCardId | let | getUserIllustration | number | 保存 illustration卡牌ID，用于定位对应业务实体。 |
| 451 | trainingStatus | let | getUserIllustration | boolean | 变量，在 getUserIllustration 中保存 training状态 值，供当前逻辑读取或更新。 |
| 452 | viewProfileSituationStatus | let | getUserIllustration | string | 变量，在 getUserIllustration 中保存 viewProfileSituation状态 值，供当前逻辑读取或更新。 |

### models/server.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 29 | <anonymous> | callback | serverList | serverCode: 推断 | 推断 | 作为 \`BANGDREAM_SERVER_CODES.map\` 的回调，处理 serverCode。 |
| 38 | getServerByServerId | function | 模块顶层 | serverId: number | Server | 在BangDream 领域模型层中获取服务器By服务器ID。 |
| 53 | getServerByName | function | 模块顶层 | name: string | Server | 在BangDream 领域模型层中获取服务器By名称。 |
| 76 | getIcon | function | 模块顶层 | server: Server | Promise<Image> | 在BangDream 领域模型层中获取图标。 |
| 100 | getServerByPriority | function | 模块顶层 | content: Array<any>; displayedServerList: Server[] | 推断 | 在BangDream 领域模型层中获取服务器ByPriority。 |
| 122 | isServer | function | 模块顶层 | server: any | boolean | 在BangDream 领域模型层中判断服务器。 |
| 137 | isServerList | function | 模块顶层 | serverList: Array<any> | boolean | 在BangDream 领域模型层中判断服务器列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 28 | serverList | const | 模块顶层 | Array<Server> | 保存 服务器列表，用于按顺序遍历或批量渲染。 |
| 55 | server | let | getServerByName | Server | 保存当前目标服务器枚举或服务器代码。 |
| 58 | i | let | getServerByName | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 68 | serverIconCache | const | 模块顶层 | { [server: number]: Image } | 变量，在 模块顶层 中保存 服务器Icon缓存 值，供当前逻辑读取或更新。 |
| 80 | image | let | getIcon | Image | 保存当前加载或绘制的图片对象。 |
| 84 | iconSvgBuffer | const | getIcon | 推断: AwaitExpression | 保存 iconSvg缓冲区，用于二进制资源处理。 |
| 87 | iconPngBuffer | const | getIcon | 推断: AwaitExpression | 保存 iconPng缓冲区，用于二进制资源处理。 |
| 104 | serverPriority | const | getServerByPriority | Server[] | 变量，在 getServerByPriority 中保存 服务器Priority 值，供当前逻辑读取或更新。 |
| 107 | i | let | getServerByPriority | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 108 | tempServer | const | getServerByPriority | 推断: ElementAccessExpression | 变量，在 getServerByPriority 中保存 临时服务器 值，供当前逻辑读取或更新。 |
| 138 | result | let | isServerList | 推断: TrueKeyword | 保存当前函数最终返回或阶段性处理结果。 |
| 139 | i | let | isServerList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 140 | element | const | isServerList | 推断: ElementAccessExpression | 变量，在 isServerList 中保存 element 值，供当前逻辑读取或更新。 |

### models/skill.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | constructor | constructor | Skill | skillId: number | - | 构造 Skill 实例，并初始化该模型的本地基础字段。 |
| 37 | getData | method | Skill | - | 推断 | 在 Skill 模型中请求当前模型的远端详情数据。 |
| 45 | getEffectTypes | method | Skill | - | Array<string> | 在 Skill 模型中获取Effect类型列表。 |
| 87 | <anonymous> | callback | getEffectTypes | a: 推断; b: 推断 | 推断 | 作为 \`tempTypeList.sort\` 的回调，处理 a、b。 |
| 97 | getSkillDescription | method | Skill | - | Array<string> | 在 Skill 模型中获取技能Description。 |
| 105 | <anonymous> | callback | getSkillDescription | value: number; index: number | 推断 | 作为 \`this.duration.forEach\` 的回调，处理 value、index。 |
| 118 | <anonymous> | callback | getSkillDescription | value: number; index: number | 推断 | 作为 \`this.data['onceEffect']['onceEffectValue'].forEach\` 的回调，处理 value、index。 |
| 127 | <anonymous> | callback | getSkillDescription | value: 推断 | 推断 | 作为 \`tempDescription.map\` 的回调，处理 value。 |
| 136 | <anonymous> | callback | getSkillDescription | value: 推断 | 推断 | 作为 \`tempDescription.map\` 的回调，处理 value。 |
| 145 | <anonymous> | callback | getSkillDescription | value: 推断 | 推断 | 作为 \`tempDescription.map\` 的回调，处理 value。 |
| 160 | getScoreUpMaxValue | method | Skill | - | number | 在 Skill 模型中获取分数UpMax值。 |
| 178 | <anonymous> | callback | getScoreUpMaxValue | element: 推断 | 推断 | 作为 \`this.data['activationEffect']['activateEffectTypes'][i][ 'activateEffectValue' ].forEach\` 的回调，处理 element。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 4 | skillId | class-field | Skill | number | 保存 技能ID，用于定位对应业务实体。 |
| 5 | isExist | class-field | Skill | boolean | 布尔标记，表示 isExist 的判断结果。 |
| 6 | data | class-field | Skill | object | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 7 | simpleDescription | class-field | Skill | Array<string \| null> | 字段，在 Skill 中保存 simpleDescription 值，供当前逻辑读取或更新。 |
| 8 | description | class-field | Skill | Array<string \| null> | 字段，在 Skill 中保存 description 值，供当前逻辑读取或更新。 |
| 9 | duration | class-field | Skill | Array<number> | 字段，在 Skill 中保存 duration 值，供当前逻辑读取或更新。 |
| 10 | effectTypes | class-field | Skill | Array<string> | 字段，在 Skill 中保存 effect类型列表 值，供当前逻辑读取或更新。 |
| 12 | scoreUpMaxValue | class-field | Skill | number | 字段，在 Skill 中保存 分数Up最大值值 值，供当前逻辑读取或更新。 |
| 47 | skillTypeList | const | getEffectTypes | 推断: ArrayLiteralExpression | 保存 技能类型列表，用于按顺序遍历或批量渲染。 |
| 58 | tempTypeList | let | getEffectTypes | Array<string> | 保存 临时类型列表，用于按顺序遍历或批量渲染。 |
| 63 | i | const | getEffectTypes | 推断 | 保存循环下标或对象键。 |
| 104 | durationList | let | getSkillDescription | string | 保存 duration列表，用于按顺序遍历或批量渲染。 |
| 112 | tempDescription | let | getSkillDescription | 推断: PropertyAccessExpression | 变量，在 getSkillDescription 中保存 临时Description 值，供当前逻辑读取或更新。 |
| 116 | onceEffectValueList | let | getSkillDescription | string | 保存 onceEffect值列表，用于按顺序遍历或批量渲染。 |
| 166 | numbers | const | getScoreUpMaxValue | Array<number> | 变量，在 getScoreUpMaxValue 中保存 数字列表 值，供当前逻辑读取或更新。 |
| 175 | i | const | getScoreUpMaxValue | 推断 | 保存循环下标或对象键。 |

### models/song.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 104 | constructor | constructor | Song | songId: number | - | 构造 Song 实例，并初始化该模型的本地基础字段。 |
| 145 | initFull | method | Song | - | 推断 | 在 Song 模型中加载远端完整详情并标记初始化状态。 |
| 188 | getData | method | Song | - | 推断 | 在 Song 模型中请求当前模型的远端详情数据。 |
| 199 | getSongRip | method | Song | - | number | 在 Song 模型中获取歌曲资源批次。 |
| 208 | getSongJacketImage | method | Song | displayedServerList: Server[] | Promise<Image> | 在 Song 模型中获取歌曲封面图片。 |
| 230 | getSongJacketImageURL | method | Song | displayedServerList: Server[] | string | 在 Song 模型中获取歌曲封面图片URL。 |
| 248 | getTagName | method | Song | - | string | 在 Song 模型中获取Tag名称。 |
| 260 | getSongChart | method | Song | difficultyId: number | Promise<object> | 在 Song 模型中获取歌曲谱面。 |
| 290 | calcMeta | method | Song | withFever: boolean; difficultyId: number; scoreUpMaxValue: number; skillDuration: number; accruacy: number | number | 在 Song 模型中计算Meta。 |
| 327 | getPresentSongList | function | 模块顶层 | mainServer: Server; start: number; end: number | Song[] | 在BangDream 领域模型层中获取Present歌曲列表。 |
| 376 | getMetaRanking | function | 模块顶层 | withFever: boolean; mainServer: Server | SongInRank[] | 在BangDream 领域模型层中获取MetaRanking。 |
| 408 | <anonymous> | callback | getMetaRanking | a: 推断; b: 推断 | 推断 | 作为 \`songRankList.sort\` 的回调，处理 a、b。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 20 | difficultyName | const | 模块顶层 | Record<number, string> | 变量，在 模块顶层 中保存 难度名称 值，供当前逻辑读取或更新。 |
| 23 | tagNameList | const | 模块顶层 | Record<string, string> | 保存 tag名称列表，用于按顺序遍历或批量渲染。 |
| 25 | difficultyColorList | const | 模块顶层 | 推断: ArrayLiteralExpression | 保存 难度颜色列表，用于按顺序遍历或批量渲染。 |
| 26 | difficultyNameList | const | 模块顶层 | string[] | 保存 难度名称列表，用于按顺序遍历或批量渲染。 |
| 29 | songId | class-field | Song | number | 保存 歌曲ID，用于定位对应业务实体。 |
| 30 | isExist | class-field | Song | 推断: FalseKeyword | 布尔标记，表示 isExist 的判断结果。 |
| 31 | data | class-field | Song | object | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 32 | tag | class-field | Song | string | 字段，在 Song 中保存 tag 值，供当前逻辑读取或更新。 |
| 33 | bandId | class-field | Song | number | 保存 乐队ID，用于定位对应业务实体。 |
| 34 | jacketImage | class-field | Song | Array<string> | 保存 封面图片，用于图片绘制或输出。 |
| 35 | musicTitle | class-field | Song | Array<string \| null> | 字段，在 Song 中保存 音乐标题 值，供当前逻辑读取或更新。 |
| 36 | publishedAt | class-field | Song | Array<number \| null> | 字段，在 Song 中保存 publishedAt 值，供当前逻辑读取或更新。 |
| 37 | closedAt | class-field | Song | Array<number \| null> | 字段，在 Song 中保存 closedAt 值，供当前逻辑读取或更新。 |
| 38 | difficulty | class-field | Song | { [difficultyId: number]: { playLevel: number; multiLiveScoreMap?: object; notesQuantity?: number; scoreC?: number; scoreB?: number; scoreA?: number; scoreS?: number; scoreSS?: number; publishedAt?: Array<number \| null>; }; } | 字段，在 Song 中保存 难度 值，供当前逻辑读取或更新。 |
| 40 | playLevel | type-field | Song | number | 字段，在 Song 中保存 play等级 值，供当前逻辑读取或更新。 |
| 41 | multiLiveScoreMap | type-field | Song | object | 保存 multiLive分数映射 映射，用于按键快速查找。 |
| 42 | notesQuantity | type-field | Song | number | 字段，在 Song 中保存 音符列表Quantity 值，供当前逻辑读取或更新。 |
| 43 | scoreC | type-field | Song | number | 字段，在 Song 中保存 分数C 值，供当前逻辑读取或更新。 |
| 44 | scoreB | type-field | Song | number | 字段，在 Song 中保存 分数B 值，供当前逻辑读取或更新。 |
| 45 | scoreA | type-field | Song | number | 字段，在 Song 中保存 分数A 值，供当前逻辑读取或更新。 |
| 46 | scoreS | type-field | Song | number | 字段，在 Song 中保存 分数S 值，供当前逻辑读取或更新。 |
| 47 | scoreSS | type-field | Song | number | 字段，在 Song 中保存 分数SS 值，供当前逻辑读取或更新。 |
| 48 | publishedAt | type-field | Song | Array<number \| null> | 字段，在 Song 中保存 publishedAt 值，供当前逻辑读取或更新。 |
| 51 | length | class-field | Song | number | 字段，在 Song 中保存 length 值，供当前逻辑读取或更新。 |
| 52 | notes | class-field | Song | { [difficultyId: number]: number; } | 字段，在 Song 中保存 音符列表 值，供当前逻辑读取或更新。 |
| 55 | bpm | class-field | Song | { [difficultyId: number]: Array<{ bpm: number; start: number; end: number; }>; } | 字段，在 Song 中保存 BPM 值，供当前逻辑读取或更新。 |
| 57 | bpm | type-field | Song | number | 字段，在 Song 中保存 BPM 值，供当前逻辑读取或更新。 |
| 58 | start | type-field | Song | number | 字段，在 Song 中保存 start 值，供当前逻辑读取或更新。 |
| 59 | end | type-field | Song | number | 字段，在 Song 中保存 end 值，供当前逻辑读取或更新。 |
| 64 | bgmId | class-field | Song | string | 保存 bgmID，用于定位对应业务实体。 |
| 65 | bgmFile | class-field | Song | string | 字段，在 Song 中保存 bgm文件 值，供当前逻辑读取或更新。 |
| 66 | seq | class-field | Song | number | 字段，在 Song 中保存 seq 值，供当前逻辑读取或更新。 |
| 67 | achievements | class-field | Song | Array<{ musicId: number; achievementType: string; rewardType: string; quantity: number; }> | 字段，在 Song 中保存 achievements 值，供当前逻辑读取或更新。 |
| 68 | musicId | type-field | Song | number | 保存 音乐ID，用于定位对应业务实体。 |
| 69 | achievementType | type-field | Song | string | 字段，在 Song 中保存 achievement类型 值，供当前逻辑读取或更新。 |
| 70 | rewardType | type-field | Song | string | 字段，在 Song 中保存 奖励类型 值，供当前逻辑读取或更新。 |
| 71 | quantity | type-field | Song | number | 字段，在 Song 中保存 quantity 值，供当前逻辑读取或更新。 |
| 73 | detail | class-field | Song | { lyricist: string[]; composer: string[]; arranger: string[]; } | 字段，在 Song 中保存 详情 值，供当前逻辑读取或更新。 |
| 74 | lyricist | type-field | Song | string[] | 字段，在 Song 中保存 lyricist 值，供当前逻辑读取或更新。 |
| 75 | composer | type-field | Song | string[] | 字段，在 Song 中保存 composer 值，供当前逻辑读取或更新。 |
| 76 | arranger | type-field | Song | string[] | 字段，在 Song 中保存 arranger 值，供当前逻辑读取或更新。 |
| 78 | howToGet | class-field | Song | Array<string \| null> | 字段，在 Song 中保存 howToGet 值，供当前逻辑读取或更新。 |
| 80 | songLevels | class-field | Song | number[] | 字段，在 Song 中保存 歌曲等级列表 值，供当前逻辑读取或更新。 |
| 81 | nickname | class-field | Song | string \| null | 字段，在 Song 中保存 nickname 值，供当前逻辑读取或更新。 |
| 84 | hasMeta | class-field | Song | 推断: FalseKeyword | 布尔标记，表示 hasMeta 的判断结果。 |
| 86 | meta | class-field | Song | { [difficultyId: number]: { [skillDuration: number]: [ withoutFeverWithoutSkill: number, withoutFeverWithSkill: number, withFeverWithoutSkill: number, withFeverWithSkill: number, ]; }; } | 字段，在 Song 中保存 Meta 值，供当前逻辑读取或更新。 |
| 97 | isInitfull | class-field | Song | 推断: FalseKeyword | 布尔标记，表示 isInitfull 的判断结果。 |
| 106 | songData | const | Song | 推断: ElementAccessExpression | 变量，在 Song 中保存 歌曲数据 值，供当前逻辑读取或更新。 |
| 129 | i | const | Song | 推断 | 保存循环下标或对象键。 |
| 130 | playLevel | const | Song | 推断: PropertyAccessExpression | 变量，在 Song 中保存 play等级 值，供当前逻辑读取或更新。 |
| 135 | metaData | const | Song | 推断: ElementAccessExpression | 变量，在 Song 中保存 Meta数据 值，供当前逻辑读取或更新。 |
| 152 | songData | const | initFull | 推断: AwaitExpression | 变量，在 initFull 中保存 歌曲数据 值，供当前逻辑读取或更新。 |
| 189 | songData | const | getData | 推断: AwaitExpression | 变量，在 getData 中保存 歌曲数据 值，供当前逻辑读取或更新。 |
| 211 | jacketImageUrl | const | getSongJacketImage | 推断: CallExpression | 保存 封面图片URL，用于请求接口或下载资源。 |
| 212 | jacketImageBuffer | let | getSongJacketImage | 推断: AwaitExpression | 保存 封面图片缓冲区，用于二进制资源处理。 |
| 215 | jacketImageName | const | getSongJacketImage | 推断: ElementAccessExpression | 变量，在 getSongJacketImage 中保存 封面图片名称 值，供当前逻辑读取或更新。 |
| 216 | server | const | getSongJacketImage | 推断 | 保存当前目标服务器枚举或服务器代码。 |
| 217 | retryUrl | const | getSongJacketImage | 推断: TemplateExpression | 保存 retryURL，用于请求接口或下载资源。 |
| 231 | server | let | getSongJacketImageURL | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 232 | jacketImageName | const | getSongJacketImageURL | 推断: ElementAccessExpression | 变量，在 getSongJacketImageURL 中保存 封面图片名称 值，供当前逻辑读取或更新。 |
| 233 | songRip | let | getSongJacketImageURL | 推断: CallExpression | 变量，在 getSongJacketImageURL 中保存 歌曲Rip 值，供当前逻辑读取或更新。 |
| 240 | jacketImageUrl | const | getSongJacketImageURL | 推断: TemplateExpression | 保存 封面图片URL，用于请求接口或下载资源。 |
| 261 | songChart | const | getSongChart | 推断: AwaitExpression | 变量，在 getSongChart 中保存 歌曲谱面 值，供当前逻辑读取或更新。 |
| 300 | skillParameter | let | calcMeta | number | 变量，在 calcMeta 中保存 技能Parameter 值，供当前逻辑读取或更新。 |
| 312 | scoreParameter | const | calcMeta | 推断: BinaryExpression | 变量，在 calcMeta 中保存 分数Parameter 值，供当前逻辑读取或更新。 |
| 332 | songList | const | getPresentSongList | Array<Song> | 保存 歌曲列表，用于按顺序遍历或批量渲染。 |
| 333 | songListMain | const | getPresentSongList | 推断: ElementAccessExpression | 变量，在 getPresentSongList 中保存 歌曲列表主数据 值，供当前逻辑读取或更新。 |
| 335 | songId | const | getPresentSongList | 推断 | 保存 歌曲ID，用于定位对应业务实体。 |
| 337 | song | const | getPresentSongList | 推断: NewExpression | 保存当前歌曲领域模型实例。 |
| 348 | i | const | getPresentSongList | 推断 | 保存循环下标或对象键。 |
| 364 | songId | type-field | 模块顶层 | number | 保存 歌曲ID，用于定位对应业务实体。 |
| 365 | difficulty | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 难度 值，供当前逻辑读取或更新。 |
| 366 | meta | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 Meta 值，供当前逻辑读取或更新。 |
| 367 | rank | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 rank 值，供当前逻辑读取或更新。 |
| 380 | songIdList | const | getMetaRanking | 推断: CallExpression | 保存 歌曲ID列表，用于按顺序遍历或批量渲染。 |
| 381 | songRankList | const | getMetaRanking | SongInRank[] | 保存 歌曲Rank列表，用于按顺序遍历或批量渲染。 |
| 382 | i | let | getMetaRanking | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 383 | songId | const | getMetaRanking | 推断: ElementAccessExpression | 保存 歌曲ID，用于定位对应业务实体。 |
| 384 | song | const | getMetaRanking | 推断: NewExpression | 保存当前歌曲领域模型实例。 |
| 397 | j | const | getMetaRanking | 推断 | 保存嵌套循环下标或对象键。 |
| 398 | difficulty | const | getMetaRanking | 推断: CallExpression | 变量，在 getMetaRanking 中保存 难度 值，供当前逻辑读取或更新。 |
| 399 | meta | const | getMetaRanking | 推断: CallExpression | 变量，在 getMetaRanking 中保存 Meta 值，供当前逻辑读取或更新。 |
| 411 | i | let | getMetaRanking | 推断: FirstLiteralToken | 保存循环下标或对象键。 |

### models/model-utils.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | readJSON | function | 模块顶层 | filepath: string | Promise<object> | 在BangDream 领域模型层中读取JSON。 |
| 12 | <anonymous> | function-expression | promise | resolve: 推断 | 推断 | 作为 \`new Promise\` 的回调，处理 resolve。 |
| 26 | readJSONFromBuffer | function | 模块顶层 | buffer: Buffer | Promise<object> | 在BangDream 领域模型层中读取JSONFrom缓冲区。 |
| 39 | writeJSON | function | 模块顶层 | filepath: string; data: object | 推断 | 在BangDream 领域模型层中写入JSON。 |
| 51 | readExcelFile | function | 模块顶层 | filePath: string | Promise<any[]> | 在BangDream 领域模型层中读取ExcelFile。 |
| 74 | stringToNumberArray | function | 模块顶层 | stringArray: Array<string \| null> | number[] | 在BangDream 领域模型层中处理stringTo数字Array。 |
| 95 | formatNumber | function | 模块顶层 | num: number; length: number | string | 在BangDream 领域模型层中格式化数字。 |
| 117 | constructor | constructor | Stack | maxLength: number | - | 构造 Stack 实例，并初始化该模型的本地基础字段。 |
| 127 | push | method | Stack | item: T | void | 在 Stack 模型中推入当前数据。 |
| 140 | pop | method | Stack | - | T \| undefined | 在 Stack 模型中处理pop。 |
| 149 | isEmpty | method | Stack | - | boolean | 在 Stack 模型中判断Empty。 |
| 158 | size | method | Stack | - | number | 在 Stack 模型中处理size。 |
| 165 | clear | method | Stack | - | void | 在 Stack 模型中清理当前数据。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 12 | promise | const | readJSON | object | 保存单个异步任务，用于等待异步流程完成。 |
| 13 | rawdata | const | promise | 推断: CallExpression | 变量，在 promise 中保存 rawdata 值，供当前逻辑读取或更新。 |
| 14 | rawstring | const | promise | 推断: CallExpression | 变量，在 promise 中保存 rawstring 值，供当前逻辑读取或更新。 |
| 15 | data | const | promise | object | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 28 | rawstring | const | readJSONFromBuffer | 推断: CallExpression | 变量，在 readJSONFromBuffer 中保存 rawstring 值，供当前逻辑读取或更新。 |
| 29 | data | const | readJSONFromBuffer | object | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 41 | rawdata | const | writeJSON | 推断: CallExpression | 变量，在 writeJSON 中保存 rawdata 值，供当前逻辑读取或更新。 |
| 53 | workbook | const | readExcelFile | 推断: CallExpression | 变量，在 readExcelFile 中保存 workbook 值，供当前逻辑读取或更新。 |
| 56 | sheetName | const | readExcelFile | 推断: ElementAccessExpression | 变量，在 readExcelFile 中保存 sheet名称 值，供当前逻辑读取或更新。 |
| 59 | worksheet | const | readExcelFile | 推断: ElementAccessExpression | 变量，在 readExcelFile 中保存 worksheet 值，供当前逻辑读取或更新。 |
| 62 | json | const | readExcelFile | 推断: CallExpression | 变量，在 readExcelFile 中保存 json 值，供当前逻辑读取或更新。 |
| 77 | numberArray | const | stringToNumberArray | number[] | 变量，在 stringToNumberArray 中保存 数字Array 值，供当前逻辑读取或更新。 |
| 78 | i | let | stringToNumberArray | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 97 | str | const | formatNumber | 推断: CallExpression | 变量，在 formatNumber 中保存 str 值，供当前逻辑读取或更新。 |
| 109 | stack | class-field | Stack | T[] | 字段，在 Stack 中保存 stack 值，供当前逻辑读取或更新。 |
| 110 | maxLength | class-field | Stack | number | 字段，在 Stack 中保存 最大值Length 值，供当前逻辑读取或更新。 |

### search/fuzzy-search.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 30 | hasOwn | arrow-function | hasOwn | source: object; key: string | 推断 | 在模糊搜索入口中判断对象是否包含指定自有属性。 |
| 38 | loadConfig | function | 模块顶层 | - | FuzzySearchConfig | 在模糊搜索入口中加载模糊搜索配置文件。 |
| 50 | extractLvNumber | function | 模块顶层 | str: string | number \| null | 在模糊搜索入口中从等级关键词中提取数字等级。 |
| 61 | isInteger | function | 模块顶层 | value: string | boolean | 在模糊搜索入口中判断字符串是否为非负整数。 |
| 71 | extractKeywords | function | 模块顶层 | keyword: string | string[] | 在模糊搜索入口中按空白和引号拆分搜索关键词。 |
| 72 | <anonymous> | callback | extractKeywords | item: 推断 | 推断 | 作为 \`(keyword.match(KEYWORD_PATTERN) \|\| []).map\` 的回调，处理 item。 |
| 83 | normalizeRelationKeyword | function | 模块顶层 | keyword: string | string | 在模糊搜索入口中统一关系表达式中的符号写法。 |
| 96 | appendTo | arrow-function | appendTo | matches: FuzzySearchResult | 推断 | 在模糊搜索入口中创建向匹配结果追加值的写入器。 |
| 98 | <anonymous> | callback | appendTo | key: string | 推断 | 作为 appendTo 的内联回调，处理 key。 |
| 99 | <anonymous> | callback | appendTo | value: FuzzySearchMatchValue | void | 作为 appendTo 的内联回调，处理 value。 |
| 109 | parseConfigKey | function | 模块顶层 | key: string | FuzzySearchMatchValue | 在模糊搜索入口中把配置键转换成数字或字符串匹配值。 |
| 120 | configValueMatches | function | 模块顶层 | value: FuzzySearchConfigValue; keyword: string | boolean | 在模糊搜索入口中判断配置值是否命中关键词。 |
| 143 | appendConfigMatches | function | 模块顶层 | keyword: string; push: ReturnType<typeof appendTo> | boolean | 在模糊搜索入口中把配置命中结果写入模糊搜索结果。 |
| 178 | isFuzzySearchResult | function | 模块顶层 | value: unknown | value is FuzzySearchResult | 在模糊搜索入口中校验模糊搜索结果结构。 |
| 185 | <anonymous> | callback | isFuzzySearchResult | arr: 推断 | 推断 | 作为 \`Object.values(value).every\` 的回调，处理 arr。 |
| 187 | <anonymous> | callback | isFuzzySearchResult | item: 推断 | 推断 | 作为 \`arr.every\` 的回调，处理 item。 |
| 197 | fuzzySearch | function | 模块顶层 | keyword: string | FuzzySearchResult | 在模糊搜索入口中把用户关键词解析成结构化匹配条件。 |
| 237 | isValidRelationStr | function | 模块顶层 | _relationStr: string | boolean | 在模糊搜索入口中判断关系表达式是否可用于范围匹配。 |
| 238 | <anonymous> | callback | isValidRelationStr | pattern: 推断 | 推断 | 作为 \`RELATION_PATTERNS.some\` 的回调，处理 pattern。 |
| 247 | isReservedMatchKey | function | 模块顶层 | key: string | boolean | 在模糊搜索入口中判断字段是否为模糊搜索保留键。 |
| 258 | candidateMatches | function | 模块顶层 | candidates: FuzzySearchMatchValue[]; targetValue: unknown | boolean | 在模糊搜索入口中判断候选值是否命中目标字段值。 |
| 263 | <anonymous> | callback | candidateMatches | item: 推断 | 推断 | 作为 \`targetValue.some\` 的回调，处理 item。 |
| 267 | <anonymous> | callback | candidateMatches | candidate: 推断 | 推断 | 作为 \`candidates.some\` 的回调，处理 candidate。 |
| 274 | <anonymous> | callback | candidateMatches | candidate: 推断 | 推断 | 作为 \`candidates.some\` 的回调，处理 candidate。 |
| 289 | numberAliasMatches | function | 模块顶层 | matches: FuzzySearchResult; target: any; key: string; numberTypeKey: string[] | boolean | 在模糊搜索入口中判断数字别名是否命中目标字段。 |
| 311 | targetMatchesKey | function | 模块顶层 | matches: FuzzySearchResult; target: any; key: string; numberTypeKey: string[] | boolean | 在模糊搜索入口中判断目标对象指定字段是否命中搜索条件。 |
| 330 | allKeywordMatches | function | 模块顶层 | targetValue: unknown; searchValue: string | boolean | 在模糊搜索入口中判断兜底关键词是否命中任意目标值。 |
| 336 | <anonymous> | callback | allKeywordMatches | item: 推断 | 推断 | 作为 \`targetValue.some\` 的回调，处理 item。 |
| 350 | targetIncludesAllKeyword | function | 模块顶层 | target: any; rawSearchValue: FuzzySearchMatchValue | boolean | 在模糊搜索入口中处理targetIncludes全部关键词。 |
| 373 | getMatchKeyCount | function | 模块顶层 | matches: FuzzySearchResult | number | 在模糊搜索入口中获取匹配KeyCount。 |
| 390 | matchesOnlyAll | function | 模块顶层 | matches: FuzzySearchResult; keyCount: number | boolean | 在模糊搜索入口中处理匹配结果Only全部。 |
| 402 | match | function | 模块顶层 | matches: FuzzySearchResult; target: any; numberTypeKey: string[] | boolean | 在模糊搜索入口中执行结构化模糊搜索条件匹配。 |
| 417 | <anonymous> | callback | match | keyword: 推断 | 推断 | 作为 \`matches._all.some\` 的回调，处理 keyword。 |
| 453 | test | arrow-function | RELATION_CHECKERS | num: 推断; match: 推断 | 推断 | 在模糊搜索入口中处理test。 |
| 463 | test | arrow-function | RELATION_CHECKERS | num: 推断; match: 推断 | 推断 | 在模糊搜索入口中处理test。 |
| 473 | test | arrow-function | RELATION_CHECKERS | num: 推断; match: 推断 | 推断 | 在模糊搜索入口中处理test。 |
| 484 | createRelationMatcher | function | 模块顶层 | _relationStr: string | (num: number) => boolean | 在模糊搜索入口中创建数值关系表达式匹配器。 |
| 489 | <anonymous> | callback | createRelationMatcher | num: 推断 | 推断 | 作为 createRelationMatcher 的内联回调，处理 num。 |
| 503 | checkRelationList | function | 模块顶层 | num: number; _relationStrList: string[] | boolean | 在模糊搜索入口中检查数值列表是否满足关系表达式。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 19 | KEYWORD_PATTERN | const | 模块顶层 | 推断: RegularExpressionLiteral | 模块常量，保存 关键词PATTERN 配置或静态映射。 |
| 20 | QUOTE_EDGE_PATTERN | const | 模块顶层 | 推断: RegularExpressionLiteral | 模块常量，保存 QUOTEEDGEPATTERN 配置或静态映射。 |
| 21 | RESERVED_MATCH_KEYS | const | 模块顶层 | 推断: NewExpression | 模块常量，保存 RESERVED匹配KEYS 配置或静态映射。 |
| 22 | RELATION_PATTERNS | const | 模块顶层 | 推断: ArrayLiteralExpression | 模块常量，保存 关系表达式PATTERNS 配置或静态映射。 |
| 30 | hasOwn | const | 模块顶层 | 推断: ArrowFunction | 布尔标记，表示 hasOwn 的判断结果。 |
| 39 | fileContent | const | loadConfig | 推断: CallExpression | 变量，在 loadConfig 中保存 文件Content 值，供当前逻辑读取或更新。 |
| 51 | match | const | extractLvNumber | 推断: CallExpression | 变量，在 extractLvNumber 中保存 匹配 值，供当前逻辑读取或更新。 |
| 96 | appendTo | const | 模块顶层 | 推断: ArrowFunction | 变量，在 模块顶层 中保存 appendTo 值，供当前逻辑读取或更新。 |
| 147 | matched | let | appendConfigMatches | 推断: FalseKeyword | 变量，在 appendConfigMatches 中保存 matched 值，供当前逻辑读取或更新。 |
| 149 | type | const | appendConfigMatches | 推断 | 变量，在 appendConfigMatches 中保存 类型 值，供当前逻辑读取或更新。 |
| 150 | typeConfig | const | appendConfigMatches | 推断: ElementAccessExpression | 变量，在 appendConfigMatches 中保存 类型配置 值，供当前逻辑读取或更新。 |
| 151 | pushType | const | appendConfigMatches | 推断: CallExpression | 变量，在 appendConfigMatches 中保存 push类型 值，供当前逻辑读取或更新。 |
| 153 | key | const | appendConfigMatches | 推断 | 变量，在 appendConfigMatches 中保存 key 值，供当前逻辑读取或更新。 |
| 154 | matchValue | const | appendConfigMatches | 推断: CallExpression | 变量，在 appendConfigMatches 中保存 匹配值 值，供当前逻辑读取或更新。 |
| 155 | value | const | appendConfigMatches | 推断 | 变量，在 appendConfigMatches 中保存 值 值，供当前逻辑读取或更新。 |
| 169 | config | const | 模块顶层 | FuzzySearchConfig | 保存当前模块或函数使用的运行配置。 |
| 198 | matches | const | fuzzySearch | FuzzySearchResult | 保存模糊搜索解析出的结构化命中结果。 |
| 199 | push | const | fuzzySearch | 推断: CallExpression | 变量，在 fuzzySearch 中保存 push 值，供当前逻辑读取或更新。 |
| 201 | rawKeyword | const | fuzzySearch | 推断 | 变量，在 fuzzySearch 中保存 raw关键词 值，供当前逻辑读取或更新。 |
| 202 | keywordLowerCase | const | fuzzySearch | 推断: CallExpression | 变量，在 fuzzySearch 中保存 关键词LowerCase 值，供当前逻辑读取或更新。 |
| 209 | normalizedKeyword | const | fuzzySearch | 推断: CallExpression | 变量，在 fuzzySearch 中保存 normalized关键词 值，供当前逻辑读取或更新。 |
| 210 | lvNumber | const | fuzzySearch | 推断: CallExpression | 变量，在 fuzzySearch 中保存 lv数字 值，供当前逻辑读取或更新。 |
| 358 | searchValue | const | targetIncludesAllKeyword | 推断: CallExpression | 变量，在 targetIncludesAllKeyword 中保存 搜索值 值，供当前逻辑读取或更新。 |
| 359 | key | const | targetIncludesAllKeyword | 推断 | 变量，在 targetIncludesAllKeyword 中保存 key 值，供当前逻辑读取或更新。 |
| 374 | count | let | getMatchKeyCount | 推断: FirstLiteralToken | 变量，在 getMatchKeyCount 中保存 数量 值，供当前逻辑读取或更新。 |
| 375 | key | const | getMatchKeyCount | 推断 | 变量，在 getMatchKeyCount 中保存 key 值，供当前逻辑读取或更新。 |
| 411 | keyCount | const | match | 推断: CallExpression | 变量，在 match 中保存 key数量 值，供当前逻辑读取或更新。 |
| 422 | matched | let | match | 推断: FalseKeyword | 变量，在 match 中保存 matched 值，供当前逻辑读取或更新。 |
| 423 | key | const | match | 推断 | 变量，在 match 中保存 key 值，供当前逻辑读取或更新。 |
| 440 | pattern | type-field | 模块顶层 | RegExp | 字段，在 模块顶层 中保存 pattern 值，供当前逻辑读取或更新。 |
| 441 | test | type-field | 模块顶层 | (num: number, match: RegExpMatchArray) => boolean | 字段，在 模块顶层 中保存 test 值，供当前逻辑读取或更新。 |
| 444 | RELATION_CHECKERS | const | 模块顶层 | RelationChecker[] | 模块常量，保存 关系表达式CHECKERS 配置或静态映射。 |
| 485 | checker | const | createRelationMatcher | 推断 | 变量，在 createRelationMatcher 中保存 checker 值，供当前逻辑读取或更新。 |
| 486 | relationMatch | const | createRelationMatcher | 推断: CallExpression | 变量，在 createRelationMatcher 中保存 关系表达式匹配 值，供当前逻辑读取或更新。 |
| 507 | relationStr | const | checkRelationList | 推断 | 变量，在 checkRelationList 中保存 关系表达式Str 值，供当前逻辑读取或更新。 |

### canvas/background.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 26 | spreadBackgroundImage | function | 模块顶层 | image: Image; width: number; height: number; brightness: number | Promise<Buffer> | 在底层绘图工具层中处理spreadBackground图片。 |
| 62 | adjustBrightness | function | 模块顶层 | image: Image; brightness: number | Promise<Image> | 在底层绘图工具层中处理adjustBrightness。 |
| 94 | getScaledDimensions | function | 模块顶层 | image: Image; targetWidth: number; targetHeight: number | { scaledWidth: number; scaledHeight: number } | 在底层绘图工具层中获取ScaledDimensions。 |
| 120 | loadImageOnce | function | 模块顶层 | - | 推断 | 在底层绘图工具层中加载图片Once。 |
| 138 | createEasyBackground | function | 模块顶层 | options1: 推断 | 推断 | 在底层绘图工具层中创建简易Background。 |
| 171 | createBackground | function | 模块顶层 | options1: BackgroundOptions | Promise<Canvas> | 在底层绘图工具层中创建Background。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 10 | image | type-field | 模块顶层 | Image \| Canvas \| any | 保存当前加载或绘制的图片对象。 |
| 11 | text | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本 值，供当前逻辑读取或更新。 |
| 12 | width | type-field | 模块顶层 | number | 保存当前绘制宽度。 |
| 13 | height | type-field | 模块顶层 | number | 保存当前绘制高度。 |
| 32 | canvas | const | spreadBackgroundImage | Canvas | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 33 | ctx | const | spreadBackgroundImage | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 36 | brightenedImage | const | spreadBackgroundImage | 推断: AwaitExpression | 保存 brightened图片，用于图片绘制或输出。 |
| 39 | scaledWidth | const | spreadBackgroundImage | 推断: CallExpression | 变量，在 spreadBackgroundImage 中保存 scaled宽度 值，供当前逻辑读取或更新。 |
| 39 | scaledHeight | const | spreadBackgroundImage | 推断: CallExpression | 变量，在 spreadBackgroundImage 中保存 scaled高度 值，供当前逻辑读取或更新。 |
| 46 | y | let | spreadBackgroundImage | 推断: FirstLiteralToken | 保存当前纵向绘制坐标。 |
| 47 | x | let | spreadBackgroundImage | 推断: FirstLiteralToken | 保存当前横向绘制坐标。 |
| 66 | canvas | const | adjustBrightness | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 67 | ctx | const | adjustBrightness | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 70 | imageData | const | adjustBrightness | 推断: CallExpression | 变量，在 adjustBrightness 中保存 图片数据 值，供当前逻辑读取或更新。 |
| 71 | data | const | adjustBrightness | 推断: PropertyAccessExpression | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 73 | factor | const | adjustBrightness | 推断: BinaryExpression | 变量，在 adjustBrightness 中保存 factor 值，供当前逻辑读取或更新。 |
| 74 | i | let | adjustBrightness | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 98 | scaledWidth | type-field | getScaledDimensions | number | 字段，在 getScaledDimensions 中保存 scaled宽度 值，供当前逻辑读取或更新。 |
| 98 | scaledHeight | type-field | getScaledDimensions | number | 字段，在 getScaledDimensions 中保存 scaled高度 值，供当前逻辑读取或更新。 |
| 99 | imageAspectRatio | const | getScaledDimensions | 推断: BinaryExpression | 变量，在 getScaledDimensions 中保存 图片AspectRatio 值，供当前逻辑读取或更新。 |
| 100 | canvasAspectRatio | const | getScaledDimensions | 推断: BinaryExpression | 变量，在 getScaledDimensions 中保存 画布AspectRatio 值，供当前逻辑读取或更新。 |
| 101 | scaledWidth | let | getScaledDimensions | number | 变量，在 getScaledDimensions 中保存 scaled宽度 值，供当前逻辑读取或更新。 |
| 101 | scaledHeight | let | getScaledDimensions | number | 变量，在 getScaledDimensions 中保存 scaled高度 值，供当前逻辑读取或更新。 |
| 114 | star | const | 模块顶层 | Image[] | 变量，在 模块顶层 中保存 star 值，供当前逻辑读取或更新。 |
| 116 | defaultBGTexture | let | 模块顶层 | Image | 变量，在 模块顶层 中保存 defaultBGTexture 值，供当前逻辑读取或更新。 |
| 139 | bgColor | const | createEasyBackground | 推断: StringLiteral | 变量，在 createEasyBackground 中保存 bg颜色 值，供当前逻辑读取或更新。 |
| 140 | canvas | const | createEasyBackground | Canvas | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 141 | ctx | const | createEasyBackground | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 144 | ratio | const | createEasyBackground | 推断: ConditionalExpression | 变量，在 createEasyBackground 中保存 ratio 值，供当前逻辑读取或更新。 |
| 146 | x | let | createEasyBackground | 推断: FirstLiteralToken | 保存当前横向绘制坐标。 |
| 147 | y | let | createEasyBackground | 推断: FirstLiteralToken | 保存当前纵向绘制坐标。 |
| 178 | backgroundBuffer | const | createBackground | 推断: AwaitExpression | 保存 background缓冲区，用于二进制资源处理。 |
| 184 | backgroundImage | const | createBackground | 推断: AwaitExpression | 保存 background图片，用于图片绘制或输出。 |
| 187 | canvas | const | createBackground | 推断: AwaitExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 195 | i | let | createBackground | 推断: FirstLiteralToken | 保存循环下标或对象键。 |

### canvas/background-star-scatter.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | scatterImages | function | 模块顶层 | options1: ScatterProps | 推断 | 在底层绘图工具层中处理scatter图片列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 4 | canvas | type-field | 模块顶层 | Canvas | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 5 | image | type-field | 模块顶层 | Image | 保存当前加载或绘制的图片对象。 |
| 6 | canvasWidth | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 画布宽度 值，供当前逻辑读取或更新。 |
| 7 | canvasHeight | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 画布高度 值，供当前逻辑读取或更新。 |
| 8 | density | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 density 值，供当前逻辑读取或更新。 |
| 9 | angleRange | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 angleRange 值，供当前逻辑读取或更新。 |
| 10 | sizeRange | type-field | 模块顶层 | [number, number] | 字段，在 模块顶层 中保存 sizeRange 值，供当前逻辑读取或更新。 |
| 28 | ctx | const | scatterImages | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 33 | area | const | scatterImages | 推断: BinaryExpression | 变量，在 scatterImages 中保存 区域 值，供当前逻辑读取或更新。 |
| 34 | numImages | const | scatterImages | 推断: CallExpression | 变量，在 scatterImages 中保存 num图片列表 值，供当前逻辑读取或更新。 |
| 37 | i | let | scatterImages | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 41 | x | const | scatterImages | 推断: BinaryExpression | 保存当前横向绘制坐标。 |
| 42 | y | const | scatterImages | 推断: BinaryExpression | 保存当前纵向绘制坐标。 |
| 43 | size | const | scatterImages | 推断: BinaryExpression | 变量，在 scatterImages 中保存 size 值，供当前逻辑读取或更新。 |
| 46 | angle | const | scatterImages | 推断: BinaryExpression | 变量，在 scatterImages 中保存 angle 值，供当前逻辑读取或更新。 |

### canvas/background-text.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 26 | drawTextOnCanvas | function | 模块顶层 | canvas: Canvas; options2: DrawTextOptions | 推断 | 在底层绘图工具层中绘制文本On画布。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 7 | text | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本 值，供当前逻辑读取或更新。 |
| 8 | fontSize | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 fontSize 值，供当前逻辑读取或更新。 |
| 9 | angle | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 angle 值，供当前逻辑读取或更新。 |
| 10 | lineSpacing | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 lineSpacing 值，供当前逻辑读取或更新。 |
| 11 | letterSpacing | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 letterSpacing 值，供当前逻辑读取或更新。 |
| 12 | strokeWidth | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 stroke宽度 值，供当前逻辑读取或更新。 |
| 13 | skewAngle | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 skewAngle 值，供当前逻辑读取或更新。 |
| 14 | opacity | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 opacity 值，供当前逻辑读取或更新。 |
| 15 | scaleX | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 scale横坐标 值，供当前逻辑读取或更新。 |
| 16 | overflow | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 overflow 值，供当前逻辑读取或更新。 |
| 17 | offsetY | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 offset纵坐标 值，供当前逻辑读取或更新。 |
| 42 | ctx | const | drawTextOnCanvas | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 56 | metrics | const | drawTextOnCanvas | 推断: CallExpression | 变量，在 drawTextOnCanvas 中保存 metrics 值，供当前逻辑读取或更新。 |
| 57 | rotatedWidth | const | drawTextOnCanvas | 推断: BinaryExpression | 变量，在 drawTextOnCanvas 中保存 rotated宽度 值，供当前逻辑读取或更新。 |
| 60 | rotatedHeight | const | drawTextOnCanvas | 推断: BinaryExpression | 变量，在 drawTextOnCanvas 中保存 rotated高度 值，供当前逻辑读取或更新。 |
| 65 | numCols | const | drawTextOnCanvas | 推断: CallExpression | 变量，在 drawTextOnCanvas 中保存 numCols 值，供当前逻辑读取或更新。 |
| 68 | numRows | const | drawTextOnCanvas | 推断: CallExpression | 变量，在 drawTextOnCanvas 中保存 numRows 值，供当前逻辑读取或更新。 |
| 79 | i | let | drawTextOnCanvas | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 83 | startY | const | drawTextOnCanvas | 推断: BinaryExpression | 变量，在 drawTextOnCanvas 中保存 start纵坐标 值，供当前逻辑读取或更新。 |
| 90 | startX | const | drawTextOnCanvas | 推断: BinaryExpression | 变量，在 drawTextOnCanvas 中保存 start横坐标 值，供当前逻辑读取或更新。 |
| 96 | j | let | drawTextOnCanvas | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 98 | x | const | drawTextOnCanvas | 推断: BinaryExpression | 保存当前横向绘制坐标。 |

### canvas/background-triangle.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 18 | createBlurredTrianglePattern | function | 模块顶层 | options1: createBlurredTrianglePatternOptions | Promise<Canvas> | 在底层绘图工具层中创建BlurredTrianglePattern。 |
| 176 | isInsideEquilateralTriangle | function | 模块顶层 | _x: number; _y: number; px: number; py: number; size: number | boolean | 在底层绘图工具层中判断InsideEquilateralTriangle。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 5 | image | type-field | 模块顶层 | Image | 保存当前加载或绘制的图片对象。 |
| 6 | blurRadius | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 blurRadius 值，供当前逻辑读取或更新。 |
| 7 | triangleSize | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 triangleSize 值，供当前逻辑读取或更新。 |
| 8 | brightnessDifference | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 brightnessDifference 值，供当前逻辑读取或更新。 |
| 27 | canvas | const | createBlurredTrianglePattern | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 28 | ctx | const | createBlurredTrianglePattern | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 31 | blurredImage | const | createBlurredTrianglePattern | 推断: AwaitExpression | 保存 blurred图片，用于图片绘制或输出。 |
| 35 | imageData | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 图片数据 值，供当前逻辑读取或更新。 |
| 36 | numRows | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 numRows 值，供当前逻辑读取或更新。 |
| 37 | numCols | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 numCols 值，供当前逻辑读取或更新。 |
| 39 | row | let | createBlurredTrianglePattern | 推断: FirstLiteralToken | 变量，在 createBlurredTrianglePattern 中保存 row 值，供当前逻辑读取或更新。 |
| 40 | rowOffset | const | createBlurredTrianglePattern | 推断: BinaryExpression | 变量，在 createBlurredTrianglePattern 中保存 rowOffset 值，供当前逻辑读取或更新。 |
| 41 | isOffsetRow | const | createBlurredTrianglePattern | 推断: BinaryExpression | 布尔标记，表示 isOffsetRow 的判断结果。 |
| 42 | isFirstColOffset | let | createBlurredTrianglePattern | 推断: Identifier | 布尔标记，表示 isFirstColOffset 的判断结果。 |
| 44 | col | let | createBlurredTrianglePattern | 推断: FirstLiteralToken | 变量，在 createBlurredTrianglePattern 中保存 col 值，供当前逻辑读取或更新。 |
| 45 | colOffset | const | createBlurredTrianglePattern | 推断: BinaryExpression | 变量，在 createBlurredTrianglePattern 中保存 colOffset 值，供当前逻辑读取或更新。 |
| 46 | triangleX | const | createBlurredTrianglePattern | 推断: ConditionalExpression | 变量，在 createBlurredTrianglePattern 中保存 triangle横坐标 值，供当前逻辑读取或更新。 |
| 47 | triangleY | const | createBlurredTrianglePattern | 推断: Identifier | 变量，在 createBlurredTrianglePattern 中保存 triangle纵坐标 值，供当前逻辑读取或更新。 |
| 50 | mirroredX | const | createBlurredTrianglePattern | 推断: BinaryExpression | 变量，在 createBlurredTrianglePattern 中保存 mirrored横坐标 值，供当前逻辑读取或更新。 |
| 51 | mirroredTriangleY | const | createBlurredTrianglePattern | 推断: BinaryExpression | 变量，在 createBlurredTrianglePattern 中保存 mirroredTriangle纵坐标 值，供当前逻辑读取或更新。 |
| 52 | mirroredYStart | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 mirrored纵坐标Start 值，供当前逻辑读取或更新。 |
| 53 | mirroredYEnd | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 mirrored纵坐标End 值，供当前逻辑读取或更新。 |
| 58 | y | let | createBlurredTrianglePattern | 推断: Identifier | 保存当前纵向绘制坐标。 |
| 59 | x | let | createBlurredTrianglePattern | 推断: FirstLiteralToken | 保存当前横向绘制坐标。 |
| 60 | pixelY | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 pixel纵坐标 值，供当前逻辑读取或更新。 |
| 61 | pixelX | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 pixel横坐标 值，供当前逻辑读取或更新。 |
| 62 | idx | const | createBlurredTrianglePattern | 推断: BinaryExpression | 变量，在 createBlurredTrianglePattern 中保存 idx 值，供当前逻辑读取或更新。 |
| 63 | isInTriangle | const | createBlurredTrianglePattern | 推断: CallExpression | 布尔标记，表示 isInTriangle 的判断结果。 |
| 70 | brightnessFactor | const | createBlurredTrianglePattern | 推断: ConditionalExpression | 变量，在 createBlurredTrianglePattern 中保存 brightnessFactor 值，供当前逻辑读取或更新。 |
| 89 | y | let | createBlurredTrianglePattern | 推断: FirstLiteralToken | 保存当前纵向绘制坐标。 |
| 90 | x | let | createBlurredTrianglePattern | 推断: FirstLiteralToken | 保存当前横向绘制坐标。 |
| 91 | pixelY | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 pixel纵坐标 值，供当前逻辑读取或更新。 |
| 92 | pixelX | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 pixel横坐标 值，供当前逻辑读取或更新。 |
| 93 | idx | const | createBlurredTrianglePattern | 推断: BinaryExpression | 变量，在 createBlurredTrianglePattern 中保存 idx 值，供当前逻辑读取或更新。 |
| 94 | isInTriangle | const | createBlurredTrianglePattern | 推断: CallExpression | 布尔标记，表示 isInTriangle 的判断结果。 |
| 101 | brightnessFactor | const | createBlurredTrianglePattern | 推断: ConditionalExpression | 变量，在 createBlurredTrianglePattern 中保存 brightnessFactor 值，供当前逻辑读取或更新。 |
| 117 | mirroredX | const | createBlurredTrianglePattern | 推断: BinaryExpression | 变量，在 createBlurredTrianglePattern 中保存 mirrored横坐标 值，供当前逻辑读取或更新。 |
| 118 | mirroredTriangleY | const | createBlurredTrianglePattern | 推断: BinaryExpression | 变量，在 createBlurredTrianglePattern 中保存 mirroredTriangle纵坐标 值，供当前逻辑读取或更新。 |
| 119 | mirroredYStart | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 mirrored纵坐标Start 值，供当前逻辑读取或更新。 |
| 120 | mirroredYEnd | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 mirrored纵坐标End 值，供当前逻辑读取或更新。 |
| 125 | y | let | createBlurredTrianglePattern | 推断: Identifier | 保存当前纵向绘制坐标。 |
| 126 | x | let | createBlurredTrianglePattern | 推断: FirstLiteralToken | 保存当前横向绘制坐标。 |
| 127 | pixelY | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 pixel纵坐标 值，供当前逻辑读取或更新。 |
| 128 | pixelX | const | createBlurredTrianglePattern | 推断: CallExpression | 变量，在 createBlurredTrianglePattern 中保存 pixel横坐标 值，供当前逻辑读取或更新。 |
| 129 | idx | const | createBlurredTrianglePattern | 推断: BinaryExpression | 变量，在 createBlurredTrianglePattern 中保存 idx 值，供当前逻辑读取或更新。 |
| 130 | isInTriangle | const | createBlurredTrianglePattern | 推断: CallExpression | 布尔标记，表示 isInTriangle 的判断结果。 |
| 137 | brightnessFactor | const | createBlurredTrianglePattern | 推断: ConditionalExpression | 变量，在 createBlurredTrianglePattern 中保存 brightnessFactor 值，供当前逻辑读取或更新。 |
| 183 | halfSize | const | isInsideEquilateralTriangle | 推断: BinaryExpression | 变量，在 isInsideEquilateralTriangle 中保存 halfSize 值，供当前逻辑读取或更新。 |
| 184 | triangleHeight | const | isInsideEquilateralTriangle | 推断: BinaryExpression | 变量，在 isInsideEquilateralTriangle 中保存 triangle高度 值，供当前逻辑读取或更新。 |

### canvas/blur-image.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | getBlurredImage | function | 模块顶层 | image: Image; blurRadius: number | Promise<Image> | 在底层绘图工具层中获取Blurred图片。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 15 | canvas | const | getBlurredImage | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 16 | ctx | const | getBlurredImage | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 26 | blurredBuffer | const | getBlurredImage | 推断: CallExpression | 保存 blurred缓冲区，用于二进制资源处理。 |
| 27 | blurredImage | const | getBlurredImage | 推断: AwaitExpression | 保存 blurred图片，用于图片绘制或输出。 |

### canvas/dotted-line.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | drawDottedLine | function | 模块顶层 | options: DrawDottedLineOptions | Canvas | 在底层绘图工具层中绘制Dotted线条。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 4 | width | type-field | 模块顶层 | number | 保存当前绘制宽度。 |
| 5 | height | type-field | 模块顶层 | number | 保存当前绘制高度。 |
| 6 | startX | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 start横坐标 值，供当前逻辑读取或更新。 |
| 7 | startY | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 start纵坐标 值，供当前逻辑读取或更新。 |
| 8 | endX | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 end横坐标 值，供当前逻辑读取或更新。 |
| 9 | endY | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 end纵坐标 值，供当前逻辑读取或更新。 |
| 10 | radius | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 radius 值，供当前逻辑读取或更新。 |
| 11 | gap | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 gap 值，供当前逻辑读取或更新。 |
| 12 | color | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 颜色 值，供当前逻辑读取或更新。 |
| 22 | width | const | drawDottedLine | 推断: Identifier | 保存当前绘制宽度。 |
| 22 | height | const | drawDottedLine | 推断: Identifier | 保存当前绘制高度。 |
| 22 | startX | const | drawDottedLine | 推断: Identifier | 变量，在 drawDottedLine 中保存 start横坐标 值，供当前逻辑读取或更新。 |
| 22 | startY | const | drawDottedLine | 推断: Identifier | 变量，在 drawDottedLine 中保存 start纵坐标 值，供当前逻辑读取或更新。 |
| 22 | endX | const | drawDottedLine | 推断: Identifier | 变量，在 drawDottedLine 中保存 end横坐标 值，供当前逻辑读取或更新。 |
| 22 | endY | const | drawDottedLine | 推断: Identifier | 变量，在 drawDottedLine 中保存 end纵坐标 值，供当前逻辑读取或更新。 |
| 22 | radius | const | drawDottedLine | 推断: Identifier | 变量，在 drawDottedLine 中保存 radius 值，供当前逻辑读取或更新。 |
| 22 | gap | const | drawDottedLine | 推断: Identifier | 变量，在 drawDottedLine 中保存 gap 值，供当前逻辑读取或更新。 |
| 22 | color | const | drawDottedLine | 推断: Identifier | 变量，在 drawDottedLine 中保存 颜色 值，供当前逻辑读取或更新。 |
| 25 | canvas | const | drawDottedLine | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 26 | ctx | const | drawDottedLine | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 29 | lineLength | const | drawDottedLine | 推断: CallExpression | 变量，在 drawDottedLine 中保存 lineLength 值，供当前逻辑读取或更新。 |
| 34 | numberOfDots | const | drawDottedLine | 推断: CallExpression | 变量，在 drawDottedLine 中保存 数字OfDots 值，供当前逻辑读取或更新。 |
| 37 | stepX | const | drawDottedLine | 推断: BinaryExpression | 变量，在 drawDottedLine 中保存 step横坐标 值，供当前逻辑读取或更新。 |
| 38 | stepY | const | drawDottedLine | 推断: BinaryExpression | 变量，在 drawDottedLine 中保存 step纵坐标 值，供当前逻辑读取或更新。 |
| 42 | i | let | drawDottedLine | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 43 | x | const | drawDottedLine | 推断: BinaryExpression | 保存当前横向绘制坐标。 |
| 44 | y | const | drawDottedLine | 推断: BinaryExpression | 保存当前纵向绘制坐标。 |

### canvas/rect.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 23 | drawRoundedRect | function | 模块顶层 | options1: RoundedRect | Canvas | 在底层绘图工具层中绘制RoundedRect。 |
| 120 | drawRoundedRectWithText | function | 模块顶层 | options1: RoundedRectWithText | Canvas | 在底层绘图工具层中绘制RoundedRectWith文本。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 7 | width | type-field | 模块顶层 | number | 保存当前绘制宽度。 |
| 8 | height | type-field | 模块顶层 | number | 保存当前绘制高度。 |
| 9 | radius | type-field | 模块顶层 | number \| [number, number, number, number] | 字段，在 模块顶层 中保存 radius 值，供当前逻辑读取或更新。 |
| 10 | color | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 颜色 值，供当前逻辑读取或更新。 |
| 11 | opacity | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 opacity 值，供当前逻辑读取或更新。 |
| 12 | strokeColor | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 stroke颜色 值，供当前逻辑读取或更新。 |
| 13 | strokeWidth | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 stroke宽度 值，供当前逻辑读取或更新。 |
| 32 | canvas | const | drawRoundedRect | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 33 | ctx | const | drawRoundedRect | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 99 | width | type-field | 模块顶层 | number | 保存当前绘制宽度。 |
| 100 | height | type-field | 模块顶层 | number | 保存当前绘制高度。 |
| 101 | radius | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 radius 值，供当前逻辑读取或更新。 |
| 102 | color | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 颜色 值，供当前逻辑读取或更新。 |
| 103 | opacity | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 opacity 值，供当前逻辑读取或更新。 |
| 104 | strokeColor | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 stroke颜色 值，供当前逻辑读取或更新。 |
| 105 | strokeWidth | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 stroke宽度 值，供当前逻辑读取或更新。 |
| 106 | font | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 font 值，供当前逻辑读取或更新。 |
| 107 | text | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本 值，供当前逻辑读取或更新。 |
| 108 | textColor | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本颜色 值，供当前逻辑读取或更新。 |
| 109 | textSize | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 文本Size 值，供当前逻辑读取或更新。 |
| 110 | textAlign | type-field | 模块顶层 | textAlign | 字段，在 模块顶层 中保存 文本Align 值，供当前逻辑读取或更新。 |
| 134 | canvas | const | drawRoundedRectWithText | 推断: CallExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 143 | ctx | const | drawRoundedRectWithText | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 149 | x | let | drawRoundedRectWithText | 推断: FirstLiteralToken | 保存当前横向绘制坐标。 |
| 150 | y | let | drawRoundedRectWithText | 推断: FirstLiteralToken | 保存当前纵向绘制坐标。 |

### canvas/output.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 14 | loadImageOnce | function | 模块顶层 | - | 推断 | 在底层绘图工具层中加载图片Once。 |
| 39 | outputFinalCanv | function-expression | outputFinalCanv | options1: OutputFinalOptions | Promise<Canvas> | 在底层绘图工具层中输出最终Canv。 |
| 103 | outputFinalBuffer | function-expression | outputFinalBuffer | options1: OutputFinalOptions | Promise<Buffer> | 在底层绘图工具层中输出最终缓冲区。 |
| 132 | createOutputFinalImages | arrow-function | createOutputFinalImages | defaultOptions: FinalImageRenderOptions | 推断 | 在底层绘图工具层中创建输出最终图片列表。 |
| 134 | <anonymous> | callback | createOutputFinalImages | imageList: OutputFinalOptions['imageList']; options: FinalImageRenderOptions | Promise<Array<Buffer \| string>> | 作为 createOutputFinalImages 的内联回调，处理 imageList、options。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 10 | BGDefaultImage | let | 模块顶层 | Image | 保存 BGDefault图片，用于图片绘制或输出。 |
| 22 | startWithSpace | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 startWithSpace 值，供当前逻辑读取或更新。 |
| 23 | imageList | type-field | 模块顶层 | Array<Image \| Canvas> | 保存 图片列表，用于按顺序遍历或批量渲染。 |
| 24 | useEasyBG | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 useEasyBG 值，供当前逻辑读取或更新。 |
| 25 | text | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本 值，供当前逻辑读取或更新。 |
| 26 | BGimage | type-field | 模块顶层 | Image \| Canvas | 字段，在 模块顶层 中保存 BGimage 值，供当前逻辑读取或更新。 |
| 27 | compress | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 compress 值，供当前逻辑读取或更新。 |
| 39 | outputFinalCanv | const | 模块顶层 | 推断: FunctionExpression | 变量，在 模块顶层 中保存 输出最终Canv 值，供当前逻辑读取或更新。 |
| 46 | allH | let | outputFinalCanv | 推断: FirstLiteralToken | 变量，在 outputFinalCanv 中保存 allH 值，供当前逻辑读取或更新。 |
| 50 | maxW | let | outputFinalCanv | 推断: FirstLiteralToken | 变量，在 outputFinalCanv 中保存 最大值W 值，供当前逻辑读取或更新。 |
| 51 | i | let | outputFinalCanv | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 58 | tempCanvas | const | outputFinalCanv | 推断: NewExpression | 保存 临时画布，用于图片绘制或输出。 |
| 59 | ctx | const | outputFinalCanv | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 83 | allH2 | let | outputFinalCanv | 推断: FirstLiteralToken | 变量，在 outputFinalCanv 中保存 allH2 值，供当前逻辑读取或更新。 |
| 87 | i | let | outputFinalCanv | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 103 | outputFinalBuffer | const | 模块顶层 | 推断: FunctionExpression | 保存 输出最终缓冲区，用于二进制资源处理。 |
| 111 | tempCanvas | const | outputFinalBuffer | 推断: AwaitExpression | 保存 临时画布，用于图片绘制或输出。 |
| 118 | tempBuffer | let | outputFinalBuffer | Buffer | 保存 临时缓冲区，用于二进制资源处理。 |
| 132 | createOutputFinalImages | const | 模块顶层 | 推断: ArrowFunction | 变量，在 模块顶层 中保存 create输出最终图片列表 值，供当前逻辑读取或更新。 |
| 138 | buffer | const | createOutputFinalImages | 推断: AwaitExpression | 保存图片、SVG 或接口下载得到的二进制缓冲区。 |
| 146 | outputEasyImages | const | 模块顶层 | 推断: CallExpression | 变量，在 模块顶层 中保存 输出Easy图片列表 值，供当前逻辑读取或更新。 |

### canvas/text.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 29 | drawText | function | 模块顶层 | options1: WrapTextOptions | Canvas | 在底层绘图工具层中绘制文本。 |
| 70 | wrapText | function | 模块顶层 | options1: WrapTextOptions | 推断 | 在底层绘图工具层中包装文本。 |
| 128 | drawTextWithImages | function | 模块顶层 | options1: TextWithImagesOptions | 推断 | 在底层绘图工具层中绘制文本With图片列表。 |
| 211 | wrapTextWithImages | function | 模块顶层 | options1: TextWithImagesOptions | 推断 | 在底层绘图工具层中包装文本With图片列表。 |
| 229 | newLine | function | wrapTextWithImages | - | 推断 | 在底层绘图工具层中处理new线条。 |
| 302 | setFontStyle | function-expression | setFontStyle | ctx: CanvasRenderingContext2D; textSize: number; font: string | 推断 | 在底层绘图工具层中设置FontStyle。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 14 | text | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本 值，供当前逻辑读取或更新。 |
| 15 | textSize | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 文本Size 值，供当前逻辑读取或更新。 |
| 16 | maxWidth | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 最大值宽度 值，供当前逻辑读取或更新。 |
| 17 | lineHeight | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 line高度 值，供当前逻辑读取或更新。 |
| 18 | color | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 颜色 值，供当前逻辑读取或更新。 |
| 19 | font | type-field | 模块顶层 | 'FangZhengHeiTi' \| 'old' \| 'default' | 字段，在 模块顶层 中保存 font 值，供当前逻辑读取或更新。 |
| 37 | wrappedTextData | const | drawText | 推断: CallExpression | 变量，在 drawText 中保存 wrapped文本数据 值，供当前逻辑读取或更新。 |
| 38 | canvas | let | drawText | Canvas | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 43 | ctx | const | drawText | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 45 | width | const | drawText | 推断: ParenthesizedExpression | 保存当前绘制宽度。 |
| 52 | ctx | const | drawText | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 53 | y | let | drawText | 推断: BinaryExpression | 保存当前纵向绘制坐标。 |
| 57 | wrappedText | const | drawText | 推断: PropertyAccessExpression | 变量，在 drawText 中保存 wrapped文本 值，供当前逻辑读取或更新。 |
| 58 | i | let | drawText | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 76 | canvas | const | wrapText | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 77 | ctx | const | wrapText | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 78 | temp | const | wrapText | 推断: CallExpression | 变量，在 wrapText 中保存 临时 值，供当前逻辑读取或更新。 |
| 82 | i | let | wrapText | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 83 | temptext | const | wrapText | 推断: ElementAccessExpression | 变量，在 wrapText 中保存 temptext 值，供当前逻辑读取或更新。 |
| 84 | a | let | wrapText | 推断: FirstLiteralToken | 变量，在 wrapText 中保存 a 值，供当前逻辑读取或更新。 |
| 85 | n | let | wrapText | 推断: FirstLiteralToken | 变量，在 wrapText 中保存 n 值，供当前逻辑读取或更新。 |
| 99 | i | let | wrapText | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 113 | textSize | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 文本Size 值，供当前逻辑读取或更新。 |
| 114 | maxWidth | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 最大值宽度 值，供当前逻辑读取或更新。 |
| 115 | lineHeight | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 line高度 值，供当前逻辑读取或更新。 |
| 116 | content | type-field | 模块顶层 | (string \| Canvas \| Image)[] | 字段，在 模块顶层 中保存 content 值，供当前逻辑读取或更新。 |
| 117 | spacing | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 spacing 值，供当前逻辑读取或更新。 |
| 118 | color | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 颜色 值，供当前逻辑读取或更新。 |
| 119 | font | type-field | 模块顶层 | 'default' \| 'old' | 字段，在 模块顶层 中保存 font 值，供当前逻辑读取或更新。 |
| 137 | wrappedTextData | const | drawTextWithImages | 推断: CallExpression | 变量，在 drawTextWithImages 中保存 wrapped文本数据 值，供当前逻辑读取或更新。 |
| 144 | wrappedText | const | drawTextWithImages | 推断: PropertyAccessExpression | 变量，在 drawTextWithImages 中保存 wrapped文本 值，供当前逻辑读取或更新。 |
| 145 | canvas | let | drawTextWithImages | Canvas | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 152 | ctx | const | drawTextWithImages | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 154 | Width | let | drawTextWithImages | 推断: FirstLiteralToken | 变量，在 drawTextWithImages 中保存 宽度 值，供当前逻辑读取或更新。 |
| 155 | n | let | drawTextWithImages | 推断: FirstLiteralToken | 变量，在 drawTextWithImages 中保存 n 值，供当前逻辑读取或更新。 |
| 160 | tempImage | const | drawTextWithImages | 推断: AsExpression | 保存 临时图片，用于图片绘制或输出。 |
| 161 | tempWidth | const | drawTextWithImages | 推断: BinaryExpression | 变量，在 drawTextWithImages 中保存 临时宽度 值，供当前逻辑读取或更新。 |
| 172 | ctx | const | drawTextWithImages | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 173 | y | let | drawTextWithImages | 推断: BinaryExpression | 保存当前纵向绘制坐标。 |
| 177 | i | let | drawTextWithImages | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 178 | tempX | let | drawTextWithImages | 推断: FirstLiteralToken | 变量，在 drawTextWithImages 中保存 临时横坐标 值，供当前逻辑读取或更新。 |
| 179 | n | let | drawTextWithImages | 推断: FirstLiteralToken | 变量，在 drawTextWithImages 中保存 n 值，供当前逻辑读取或更新。 |
| 185 | tempImage | const | drawTextWithImages | 推断: AsExpression | 保存 临时图片，用于图片绘制或输出。 |
| 186 | tempWidth | const | drawTextWithImages | 推断: BinaryExpression | 变量，在 drawTextWithImages 中保存 临时宽度 值，供当前逻辑读取或更新。 |
| 218 | canvas | const | wrapTextWithImages | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 219 | ctx | const | wrapTextWithImages | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 222 | temp | const | wrapTextWithImages | Array<Array<string \| Image \| Canvas>> | 变量，在 wrapTextWithImages 中保存 临时 值，供当前逻辑读取或更新。 |
| 223 | lineNumber | let | wrapTextWithImages | 推断: FirstLiteralToken | 变量，在 wrapTextWithImages 中保存 line数字 值，供当前逻辑读取或更新。 |
| 224 | tempX | let | wrapTextWithImages | 推断: FirstLiteralToken | 变量，在 wrapTextWithImages 中保存 临时横坐标 值，供当前逻辑读取或更新。 |
| 235 | i | let | wrapTextWithImages | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 240 | temptext | let | wrapTextWithImages | 推断: AsExpression | 变量，在 wrapTextWithImages 中保存 temptext 值，供当前逻辑读取或更新。 |
| 242 | lineBreakIndex | const | wrapTextWithImages | 推断: CallExpression | 变量，在 wrapTextWithImages 中保存 lineBreak下标 值，供当前逻辑读取或更新。 |
| 244 | substring | const | wrapTextWithImages | 推断: CallExpression | 变量，在 wrapTextWithImages 中保存 substring 值，供当前逻辑读取或更新。 |
| 251 | remainingWidth | const | wrapTextWithImages | 推断: BinaryExpression | 变量，在 wrapTextWithImages 中保存 remaining宽度 值，供当前逻辑读取或更新。 |
| 252 | measuredWidth | const | wrapTextWithImages | 推断: PropertyAccessExpression | 变量，在 wrapTextWithImages 中保存 measured宽度 值，供当前逻辑读取或更新。 |
| 258 | splitIndex | let | wrapTextWithImages | 推断: FirstLiteralToken | 变量，在 wrapTextWithImages 中保存 split下标 值，供当前逻辑读取或更新。 |
| 259 | j | let | wrapTextWithImages | 推断: BinaryExpression | 保存嵌套循环下标或对象键。 |
| 260 | substr | const | wrapTextWithImages | 推断: CallExpression | 变量，在 wrapTextWithImages 中保存 substr 值，供当前逻辑读取或更新。 |
| 261 | substrWidth | const | wrapTextWithImages | 推断: PropertyAccessExpression | 变量，在 wrapTextWithImages 中保存 substr宽度 值，供当前逻辑读取或更新。 |
| 267 | substring | const | wrapTextWithImages | 推断: CallExpression | 变量，在 wrapTextWithImages 中保存 substring 值，供当前逻辑读取或更新。 |
| 274 | tempImage | const | wrapTextWithImages | 推断: AsExpression | 保存 临时图片，用于图片绘制或输出。 |
| 275 | tempWidth | const | wrapTextWithImages | 推断: BinaryExpression | 变量，在 wrapTextWithImages 中保存 临时宽度 值，供当前逻辑读取或更新。 |
| 302 | setFontStyle | const | 模块顶层 | 推断: FunctionExpression | 变量，在 模块顶层 中保存 集合FontStyle 值，供当前逻辑读取或更新。 |

### canvas/image-utils.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 22 | loadImageFromPath | function | 模块顶层 | path: string | Promise<Image> | 在底层绘图工具层中加载图片FromPath。 |
| 39 | getTextWidth | function | 模块顶层 | text: string; textSize: number; font: string | 推断 | 在底层绘图工具层中获取文本宽度。 |
| 58 | convertSvgToPngBuffer | function | 模块顶层 | svgBuffer: Buffer | Promise<Buffer> | 在底层绘图工具层中转换SvgToPNG缓冲区。 |
| 59 | <anonymous> | callback | convertSvgToPngBuffer | resolve: 推断; reject: 推断 | 推断 | 作为 \`new Promise\` 的回调，处理 resolve、reject。 |
| 67 | <anonymous> | callback | convertSvgToPngBuffer | error: 推断; buffer: 推断 | 推断 | 作为 \`convertSvg\` 的回调，处理 error、buffer。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 6 | assetsRootPath | const | 模块顶层 | 推断: CallExpression | 保存 资源列表根目录路径，用于定位本地文件或资源目录。 |
| 7 | convertSvg | const | 模块顶层 | 推断: AsExpression | 变量，在 模块顶层 中保存 convertSvg 值，供当前逻辑读取或更新。 |
| 12 | assetErrorImageBuffer | const | 模块顶层 | 推断: CallExpression | 保存 资源错误对象图片缓冲区，用于二进制资源处理。 |
| 27 | buffer | const | loadImageFromPath | 推断: CallExpression | 保存图片、SVG 或接口下载得到的二进制缓冲区。 |
| 40 | canvas | const | getTextWidth | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 41 | context | const | getTextWidth | 推断: CallExpression | 变量，在 getTextWidth 中保存 context 值，供当前逻辑读取或更新。 |
| 47 | metrics | const | getTextWidth | 推断: CallExpression | 变量，在 getTextWidth 中保存 metrics 值，供当前逻辑读取或更新。 |
| 61 | svgString | const | convertSvgToPngBuffer | 推断: CallExpression | 变量，在 convertSvgToPngBuffer 中保存 svgString 值，供当前逻辑读取或更新。 |

### render-blocks/song-chart-preview.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 104 | sortTimepoints | function | 模块顶层 | timepoints: BestdoriNote[] | BestdoriNote[] | 在图片布局层中按节拍排序 BPM 时间点并写入累计时间。 |
| 105 | <anonymous> | callback | sortTimepoints | a: 推断; b: 推断 | 推断 | 作为 \`timepoints.sort\` 的回调，处理 a、b。 |
| 128 | findTimepointAtBeat | function | 模块顶层 | timepoints: BestdoriNote[]; beat: number | BestdoriNote | 在图片布局层中用二分查找定位节拍所在的 BPM 时间点。 |
| 156 | getNoteTime | function | 模块顶层 | timepoints: BestdoriNote[]; beat: number | number | 在图片布局层中根据 BPM 时间点计算谱面音符时间。 |
| 169 | assignChartTimes | function | 模块顶层 | chart: BestdoriNote[] | BestdoriNote[] | 在图片布局层中为谱面音符写入实际时间。 |
| 171 | <anonymous> | callback | timepoints | note: 推断 | 推断 | 作为 \`chart.filter\` 的回调，处理 note。 |
| 197 | addSimNote | function | 模块顶层 | notes: PreviewNote[]; beat: number; time: number; lane: number | void | 在图片布局层中为同拍音符补充双押标记。 |
| 215 | <anonymous> | callback | addSimNote | a: 推断; b: 推断 | 推断 | 作为 \`[note.lane as number, lane].sort\` 的回调，处理 a、b。 |
| 227 | getSingleNoteType | function | 模块顶层 | note: BestdoriNote | string | 在图片布局层中识别单点音符的展示类型。 |
| 246 | pushSlideNotes | function | 模块顶层 | notes: PreviewNote[]; note: BestdoriNote | void | 在图片布局层中把滑条连接点拆成可绘制音符。 |
| 302 | pushPlayableNote | function | 模块顶层 | notes: PreviewNote[]; note: BestdoriNote | void | 在图片布局层中把可游玩音符转换为预览音符。 |
| 331 | getSortLane | function | 模块顶层 | note: PreviewNote | number | 在图片布局层中获取Sort轨道。 |
| 341 | sortPreviewNotes | function | 模块顶层 | notes: PreviewNote[] | PreviewNote[] | 在图片布局层中按时间和轨道排序预览音符。 |
| 348 | typeSort | arrow-function | typeSort | type: string | number | 在图片布局层中处理类型Sort。 |
| 349 | <anonymous> | callback | sortPreviewNotes | a: 推断; b: 推断 | 推断 | 作为 \`notes.sort\` 的回调，处理 a、b。 |
| 368 | createPreviewNotes | function | 模块顶层 | chart: BestdoriNote[] | PreviewNote[] | 在图片布局层中把 Bestdori 谱面转换为预览音符列表。 |
| 392 | createPreviewLayout | function | 模块顶层 | notes: PreviewNote[] | PreviewLayout | 在图片布局层中根据谱面长度创建预览布局参数。 |
| 398 | <anonymous> | callback | displayNotes | note: 推断 | 推断 | 作为 \`notes.filter\` 的回调，处理 note。 |
| 450 | loadNoteImages | function | 模块顶层 | - | Promise<Record<string, Image>> | 在图片布局层中加载谱面预览所需音符贴图。 |
| 452 | <anonymous> | callback | entries | key: 推断 | 推断 | 作为 \`NOTE_IMAGE_KEYS.map\` 的回调，处理 key。 |
| 466 | loadCoverImage | function | 模块顶层 | cover: string \| Buffer | Promise<Image> | 在图片布局层中加载谱面预览封面图。 |
| 482 | setAdaptiveTextBaseline | function | 模块顶层 | ctx: any; layout: PreviewLayout; fontSize: number; y: number | void | 在图片布局层中设置Adaptive文本Baseline。 |
| 503 | getTimePosition | function | 模块顶层 | layout: PreviewLayout; time: number | 推断 | 在图片布局层中获取时间Position。 |
| 521 | drawBaseInfo | function | 模块顶层 | ctx: any; layout: PreviewLayout; payload: BestdoriPreviewPayload; coverImg: Image | void | 在图片布局层中绘制基础Info。 |
| 569 | drawTracks | function | 模块顶层 | ctx: any; layout: PreviewLayout | void | 在图片布局层中绘制Tracks。 |
| 607 | drawBeatLines | function | 模块顶层 | ctx: any; layout: PreviewLayout; notes: PreviewNote[] | void | 在图片布局层中绘制Beat线条列表。 |
| 613 | <anonymous> | callback | bpmList | item: 推断 | 推断 | 作为 \`notes .filter\` 的回调，处理 item。 |
| 614 | <anonymous> | callback | bpmList | a: 推断; b: 推断 | 推断 | 作为 \`notes .filter((item) => item.type === 'BPM') .sort\` 的回调，处理 a、b。 |
| 658 | drawTimeline | function | 模块顶层 | ctx: any; layout: PreviewLayout | void | 在图片布局层中绘制时间轴。 |
| 678 | drawCountAndBpmLines | function | 模块顶层 | ctx: any; layout: PreviewLayout; notes: PreviewNote[] | void | 在图片布局层中绘制CountAndBPM线条列表。 |
| 724 | drawTapNote | function | 模块顶层 | ctx: any; layout: PreviewLayout; noteImages: Record<string, Image>; note: PreviewNote | void | 在图片布局层中绘制Tap音符。 |
| 765 | drawDirectionalNote | function | 模块顶层 | ctx: any; layout: PreviewLayout; noteImages: Record<string, Image>; note: PreviewNote | void | 在图片布局层中绘制Directional音符。 |
| 817 | drawSimNote | function | 模块顶层 | ctx: any; layout: PreviewLayout; noteImages: Record<string, Image>; note: PreviewNote | void | 在图片布局层中绘制Sim音符。 |
| 825 | <anonymous> | callback | drawSimNote | a: 推断; b: 推断 | 推断 | 作为 \`lane.sort\` 的回调，处理 a、b。 |
| 847 | drawBarNote | function | 模块顶层 | ctx: any; layout: PreviewLayout; note: PreviewNote | void | 在图片布局层中绘制Bar音符。 |
| 891 | drawNotes | function | 模块顶层 | ctx: any; layout: PreviewLayout; noteImages: Record<string, Image>; notes: PreviewNote[] | void | 在图片布局层中绘制音符列表。 |
| 929 | drawBestdoriPreview | function | 模块顶层 | payload: BestdoriPreviewPayload; chart: BestdoriNote[] | Promise<Canvas> | 在图片布局层中绘制 Bestdori 谱面预览图。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 6 | id | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 ID 值，供当前逻辑读取或更新。 |
| 7 | title | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 标题 值，供当前逻辑读取或更新。 |
| 8 | artist | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 artist 值，供当前逻辑读取或更新。 |
| 9 | author | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 author 值，供当前逻辑读取或更新。 |
| 10 | diff | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 diff 值，供当前逻辑读取或更新。 |
| 11 | level | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 等级 值，供当前逻辑读取或更新。 |
| 12 | cover | type-field | 模块顶层 | string \| Buffer | 字段，在 模块顶层 中保存 cover 值，供当前逻辑读取或更新。 |
| 16 | beat | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 beat 值，供当前逻辑读取或更新。 |
| 17 | lane | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 轨道 值，供当前逻辑读取或更新。 |
| 18 | time | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 时间 值，供当前逻辑读取或更新。 |
| 19 | skill | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 技能 值，供当前逻辑读取或更新。 |
| 20 | flick | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 flick 值，供当前逻辑读取或更新。 |
| 21 | hidden | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 hidden 值，供当前逻辑读取或更新。 |
| 25 | type | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 类型 值，供当前逻辑读取或更新。 |
| 26 | beat | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 beat 值，供当前逻辑读取或更新。 |
| 27 | lane | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 轨道 值，供当前逻辑读取或更新。 |
| 28 | time | type-field | 模块顶层 | number \| number[] | 字段，在 模块顶层 中保存 时间 值，供当前逻辑读取或更新。 |
| 29 | bpm | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 BPM 值，供当前逻辑读取或更新。 |
| 30 | connections | type-field | 模块顶层 | BestdoriConnection[] | 字段，在 模块顶层 中保存 连接点列表 值，供当前逻辑读取或更新。 |
| 31 | skill | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 技能 值，供当前逻辑读取或更新。 |
| 32 | flick | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 flick 值，供当前逻辑读取或更新。 |
| 33 | direction | type-field | 模块顶层 | 'Left' \| 'Right' | 字段，在 模块顶层 中保存 direction 值，供当前逻辑读取或更新。 |
| 34 | width | type-field | 模块顶层 | number | 保存当前绘制宽度。 |
| 35 | hidden | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 hidden 值，供当前逻辑读取或更新。 |
| 39 | type | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 类型 值，供当前逻辑读取或更新。 |
| 40 | time | type-field | 模块顶层 | number \| number[] | 字段，在 模块顶层 中保存 时间 值，供当前逻辑读取或更新。 |
| 41 | lane | type-field | 模块顶层 | number \| number[] | 字段，在 模块顶层 中保存 轨道 值，供当前逻辑读取或更新。 |
| 45 | infoAreaWidth | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 info区域宽度 值，供当前逻辑读取或更新。 |
| 46 | laneWidth | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 轨道宽度 值，供当前逻辑读取或更新。 |
| 47 | splitLineWidth | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 splitLine宽度 值，供当前逻辑读取或更新。 |
| 48 | blockDistance | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 块Distance 值，供当前逻辑读取或更新。 |
| 49 | heightPerSecond | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 高度PerSecond 值，供当前逻辑读取或更新。 |
| 50 | originalWidth | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 original宽度 值，供当前逻辑读取或更新。 |
| 51 | chartLength | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 谱面Length 值，供当前逻辑读取或更新。 |
| 52 | secondsPerCol | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 secondsPerCol 值，供当前逻辑读取或更新。 |
| 53 | width | type-field | 模块顶层 | number | 保存当前绘制宽度。 |
| 54 | height | type-field | 模块顶层 | number | 保存当前绘制高度。 |
| 55 | colCount | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 col数量 值，供当前逻辑读取或更新。 |
| 58 | OFFSET | const | 模块顶层 | 推断: FirstLiteralToken | 模块常量，保存 OFFSET 配置或静态映射。 |
| 59 | NOTE_IMAGE_KEYS | const | 模块顶层 | 推断: AsExpression | 模块常量，保存 音符图片KEYS 配置或静态映射。 |
| 73 | DISPLAY_NOTE_TYPES | const | 模块顶层 | 推断: ArrayLiteralExpression | 模块常量，保存 展示音符类型列表 配置或静态映射。 |
| 81 | COUNT_LINE_NOTE_TYPES | const | 模块顶层 | 推断: ArrayLiteralExpression | 模块常量，保存 数量LINE音符类型列表 配置或静态映射。 |
| 90 | DIFFICULTY_COLOR_LIST | const | 模块顶层 | Record<string, string> | 模块常量，保存 难度颜色列表 配置或静态映射。 |
| 106 | i | let | sortTimepoints | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 107 | current | const | sortTimepoints | 推断: ElementAccessExpression | 保存迭代过程中的当前数据项。 |
| 113 | previous | const | sortTimepoints | 推断: ElementAccessExpression | 保存迭代过程中的前一个数据项。 |
| 132 | left | let | findTimepointAtBeat | 推断: FirstLiteralToken | 变量，在 findTimepointAtBeat 中保存 left 值，供当前逻辑读取或更新。 |
| 133 | right | let | findTimepointAtBeat | 推断: BinaryExpression | 变量，在 findTimepointAtBeat 中保存 right 值，供当前逻辑读取或更新。 |
| 134 | result | let | findTimepointAtBeat | 推断: ElementAccessExpression | 保存当前函数最终返回或阶段性处理结果。 |
| 137 | mid | const | findTimepointAtBeat | 推断: CallExpression | 变量，在 findTimepointAtBeat 中保存 mid 值，供当前逻辑读取或更新。 |
| 157 | timepoint | const | getNoteTime | 推断: CallExpression | 变量，在 getNoteTime 中保存 timepoint 值，供当前逻辑读取或更新。 |
| 170 | timepoints | const | assignChartTimes | 推断: CallExpression | 变量，在 assignChartTimes 中保存 timepoints 值，供当前逻辑读取或更新。 |
| 174 | note | const | assignChartTimes | 推断 | 变量，在 assignChartTimes 中保存 音符 值，供当前逻辑读取或更新。 |
| 176 | connection | const | assignChartTimes | 推断 | 变量，在 assignChartTimes 中保存 连接点 值，供当前逻辑读取或更新。 |
| 203 | note | const | addSimNote | 推断 | 变量，在 addSimNote 中保存 音符 值，供当前逻辑读取或更新。 |
| 247 | barTime | const | pushSlideNotes | number[] | 变量，在 pushSlideNotes 中保存 bar时间 值，供当前逻辑读取或更新。 |
| 248 | lane | const | pushSlideNotes | number[] | 变量，在 pushSlideNotes 中保存 轨道 值，供当前逻辑读取或更新。 |
| 249 | connections | const | pushSlideNotes | 推断: BinaryExpression | 变量，在 pushSlideNotes 中保存 连接点列表 值，供当前逻辑读取或更新。 |
| 251 | i | let | pushSlideNotes | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 252 | tick | const | pushSlideNotes | 推断: ElementAccessExpression | 变量，在 pushSlideNotes 中保存 tick 值，供当前逻辑读取或更新。 |
| 253 | time | const | pushSlideNotes | 推断: PropertyAccessExpression | 变量，在 pushSlideNotes 中保存 时间 值，供当前逻辑读取或更新。 |
| 254 | firstTick | const | pushSlideNotes | 推断: BinaryExpression | 变量，在 pushSlideNotes 中保存 firstTick 值，供当前逻辑读取或更新。 |
| 255 | lastTick | const | pushSlideNotes | 推断: BinaryExpression | 变量，在 pushSlideNotes 中保存 lastTick 值，供当前逻辑读取或更新。 |
| 304 | typedNote | const | pushPlayableNote | 推断: AsExpression | 变量，在 pushPlayableNote 中保存 typed音符 值，供当前逻辑读取或更新。 |
| 348 | typeSort | const | sortPreviewNotes | 推断: ArrowFunction | 变量，在 sortPreviewNotes 中保存 类型Sort 值，供当前逻辑读取或更新。 |
| 350 | typeSortResult | const | sortPreviewNotes | 推断: BinaryExpression | 变量，在 sortPreviewNotes 中保存 类型Sort结果 值，供当前逻辑读取或更新。 |
| 369 | notes | const | createPreviewNotes | PreviewNote[] | 变量，在 createPreviewNotes 中保存 音符列表 值，供当前逻辑读取或更新。 |
| 371 | note | const | createPreviewNotes | 推断 | 变量，在 createPreviewNotes 中保存 音符 值，供当前逻辑读取或更新。 |
| 393 | infoAreaWidth | const | createPreviewLayout | 推断: FirstLiteralToken | 变量，在 createPreviewLayout 中保存 info区域宽度 值，供当前逻辑读取或更新。 |
| 394 | laneWidth | const | createPreviewLayout | 推断: FirstLiteralToken | 变量，在 createPreviewLayout 中保存 轨道宽度 值，供当前逻辑读取或更新。 |
| 395 | splitLineWidth | const | createPreviewLayout | 推断: FirstLiteralToken | 变量，在 createPreviewLayout 中保存 splitLine宽度 值，供当前逻辑读取或更新。 |
| 396 | blockDistance | const | createPreviewLayout | 推断: FirstLiteralToken | 变量，在 createPreviewLayout 中保存 块Distance 值，供当前逻辑读取或更新。 |
| 397 | heightPerSecond | const | createPreviewLayout | 推断: FirstLiteralToken | 变量，在 createPreviewLayout 中保存 高度PerSecond 值，供当前逻辑读取或更新。 |
| 398 | displayNotes | const | createPreviewLayout | 推断: CallExpression | 变量，在 createPreviewLayout 中保存 展示音符列表 值，供当前逻辑读取或更新。 |
| 401 | chartLength | const | createPreviewLayout | 推断: CallExpression | 变量，在 createPreviewLayout 中保存 谱面Length 值，供当前逻辑读取或更新。 |
| 404 | minHeight | const | createPreviewLayout | 推断: FirstLiteralToken | 变量，在 createPreviewLayout 中保存 最小值高度 值，供当前逻辑读取或更新。 |
| 405 | originalWidth | const | createPreviewLayout | 推断: BinaryExpression | 变量，在 createPreviewLayout 中保存 original宽度 值，供当前逻辑读取或更新。 |
| 406 | originalHeight | const | createPreviewLayout | 推断: BinaryExpression | 变量，在 createPreviewLayout 中保存 original高度 值，供当前逻辑读取或更新。 |
| 407 | width | let | createPreviewLayout | 推断: BinaryExpression | 保存当前绘制宽度。 |
| 408 | height | let | createPreviewLayout | 推断: Identifier | 保存当前绘制高度。 |
| 409 | colCount | let | createPreviewLayout | 推断: FirstLiteralToken | 变量，在 createPreviewLayout 中保存 col数量 值，供当前逻辑读取或更新。 |
| 420 | newWidth | const | createPreviewLayout | 推断: BinaryExpression | 变量，在 createPreviewLayout 中保存 new宽度 值，供当前逻辑读取或更新。 |
| 421 | newHeight | const | createPreviewLayout | 推断: BinaryExpression | 变量，在 createPreviewLayout 中保存 new高度 值，供当前逻辑读取或更新。 |
| 451 | entries | const | loadNoteImages | 推断: AwaitExpression | 变量，在 loadNoteImages 中保存 entries 值，供当前逻辑读取或更新。 |
| 504 | drawCol | const | getTimePosition | 推断: CallExpression | 变量，在 getTimePosition 中保存 drawCol 值，供当前逻辑读取或更新。 |
| 505 | x | const | getTimePosition | 推断: BinaryExpression | 保存当前横向绘制坐标。 |
| 509 | y | const | getTimePosition | 推断: BinaryExpression | 保存当前纵向绘制坐标。 |
| 527 | id | const | drawBaseInfo | 推断: Identifier | 变量，在 drawBaseInfo 中保存 ID 值，供当前逻辑读取或更新。 |
| 527 | diff | const | drawBaseInfo | 推断: Identifier | 变量，在 drawBaseInfo 中保存 diff 值，供当前逻辑读取或更新。 |
| 527 | level | const | drawBaseInfo | 推断: Identifier | 变量，在 drawBaseInfo 中保存 等级 值，供当前逻辑读取或更新。 |
| 551 | coverWidth | const | drawBaseInfo | 推断: BinaryExpression | 变量，在 drawBaseInfo 中保存 cover宽度 值，供当前逻辑读取或更新。 |
| 570 | i | let | drawTracks | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 572 | x | const | drawTracks | 推断: BinaryExpression | 保存当前横向绘制坐标。 |
| 574 | w | const | drawTracks | 推断: BinaryExpression | 变量，在 drawTracks 中保存 w 值，供当前逻辑读取或更新。 |
| 575 | grd | const | drawTracks | 推断: CallExpression | 变量，在 drawTracks 中保存 grd 值，供当前逻辑读取或更新。 |
| 592 | j | let | drawTracks | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 593 | splitLineX | const | drawTracks | 推断: BinaryExpression | 变量，在 drawTracks 中保存 splitLine横坐标 值，供当前逻辑读取或更新。 |
| 612 | bpmList | const | drawBeatLines | 推断: CallExpression | 保存 BPM列表，用于按顺序遍历或批量渲染。 |
| 617 | index | let | drawBeatLines | 推断: FirstLiteralToken | 变量，在 drawBeatLines 中保存 下标 值，供当前逻辑读取或更新。 |
| 618 | bpmNote | const | drawBeatLines | 推断: ElementAccessExpression | 变量，在 drawBeatLines 中保存 BPM音符 值，供当前逻辑读取或更新。 |
| 619 | beat | let | drawBeatLines | 推断: FirstLiteralToken | 变量，在 drawBeatLines 中保存 beat 值，供当前逻辑读取或更新。 |
| 620 | previousTime | const | drawBeatLines | 推断: ConditionalExpression | 变量，在 drawBeatLines 中保存 前一项时间 值，供当前逻辑读取或更新。 |
| 623 | nextTime | const | drawBeatLines | 推断: ConditionalExpression | 变量，在 drawBeatLines 中保存 后一项时间 值，供当前逻辑读取或更新。 |
| 634 | currentTime | const | drawBeatLines | 推断: BinaryExpression | 变量，在 drawBeatLines 中保存 当前项时间 值，供当前逻辑读取或更新。 |
| 635 | x | const | drawBeatLines | 推断: CallExpression | 保存当前横向绘制坐标。 |
| 635 | y | const | drawBeatLines | 推断: CallExpression | 保存当前纵向绘制坐标。 |
| 636 | w | const | drawBeatLines | 推断: BinaryExpression | 变量，在 drawBeatLines 中保存 w 值，供当前逻辑读取或更新。 |
| 663 | i | let | drawTimeline | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 664 | x | const | drawTimeline | 推断: CallExpression | 保存当前横向绘制坐标。 |
| 664 | y | const | drawTimeline | 推断: CallExpression | 保存当前纵向绘制坐标。 |
| 683 | count | let | drawCountAndBpmLines | 推断: FirstLiteralToken | 变量，在 drawCountAndBpmLines 中保存 数量 值，供当前逻辑读取或更新。 |
| 684 | w | const | drawCountAndBpmLines | 推断: BinaryExpression | 变量，在 drawCountAndBpmLines 中保存 w 值，供当前逻辑读取或更新。 |
| 686 | note | const | drawCountAndBpmLines | 推断 | 变量，在 drawCountAndBpmLines 中保存 音符 值，供当前逻辑读取或更新。 |
| 687 | time | const | drawCountAndBpmLines | 推断: AsExpression | 变量，在 drawCountAndBpmLines 中保存 时间 值，供当前逻辑读取或更新。 |
| 688 | x | const | drawCountAndBpmLines | 推断: CallExpression | 保存当前横向绘制坐标。 |
| 688 | y | const | drawCountAndBpmLines | 推断: CallExpression | 保存当前纵向绘制坐标。 |
| 730 | drawCol | const | drawTapNote | 推断: CallExpression | 变量，在 drawTapNote 中保存 drawCol 值，供当前逻辑读取或更新。 |
| 731 | img | const | drawTapNote | 推断: ElementAccessExpression | 变量，在 drawTapNote 中保存 img 值，供当前逻辑读取或更新。 |
| 732 | w | const | drawTapNote | 推断: PropertyAccessExpression | 变量，在 drawTapNote 中保存 w 值，供当前逻辑读取或更新。 |
| 733 | h | const | drawTapNote | 推断: BinaryExpression | 变量，在 drawTapNote 中保存 h 值，供当前逻辑读取或更新。 |
| 734 | x | const | drawTapNote | 推断: BinaryExpression | 保存当前横向绘制坐标。 |
| 739 | y | const | drawTapNote | 推断: BinaryExpression | 保存当前纵向绘制坐标。 |
| 771 | drawCol | const | drawDirectionalNote | 推断: CallExpression | 变量，在 drawDirectionalNote 中保存 drawCol 值，供当前逻辑读取或更新。 |
| 772 | arrowImg | const | drawDirectionalNote | 推断: ElementAccessExpression | 变量，在 drawDirectionalNote 中保存 arrowImg 值，供当前逻辑读取或更新。 |
| 774 | direction | const | drawDirectionalNote | 推断: ConditionalExpression | 变量，在 drawDirectionalNote 中保存 direction 值，供当前逻辑读取或更新。 |
| 775 | noteWidth | const | drawDirectionalNote | 推断: BinaryExpression | 变量，在 drawDirectionalNote 中保存 音符宽度 值，供当前逻辑读取或更新。 |
| 777 | i | let | drawDirectionalNote | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 778 | w | const | drawDirectionalNote | 推断: PropertyAccessExpression | 变量，在 drawDirectionalNote 中保存 w 值，供当前逻辑读取或更新。 |
| 779 | h | const | drawDirectionalNote | 推断: BinaryExpression | 变量，在 drawDirectionalNote 中保存 h 值，供当前逻辑读取或更新。 |
| 780 | x | const | drawDirectionalNote | 推断: BinaryExpression | 保存当前横向绘制坐标。 |
| 785 | y | const | drawDirectionalNote | 推断: BinaryExpression | 保存当前纵向绘制坐标。 |
| 792 | endImg | const | drawDirectionalNote | 推断: ElementAccessExpression | 变量，在 drawDirectionalNote 中保存 endImg 值，供当前逻辑读取或更新。 |
| 796 | arrowEndX | const | drawDirectionalNote | 推断: ConditionalExpression | 变量，在 drawDirectionalNote 中保存 arrowEnd横坐标 值，供当前逻辑读取或更新。 |
| 823 | drawCol | const | drawSimNote | 推断: CallExpression | 变量，在 drawSimNote 中保存 drawCol 值，供当前逻辑读取或更新。 |
| 824 | lane | const | drawSimNote | 推断: AsExpression | 变量，在 drawSimNote 中保存 轨道 值，供当前逻辑读取或更新。 |
| 826 | simW | const | drawSimNote | 推断: BinaryExpression | 变量，在 drawSimNote 中保存 simW 值，供当前逻辑读取或更新。 |
| 827 | simH | const | drawSimNote | 推断: FirstLiteralToken | 变量，在 drawSimNote 中保存 simH 值，供当前逻辑读取或更新。 |
| 828 | simStartX | const | drawSimNote | 推断: BinaryExpression | 变量，在 drawSimNote 中保存 simStart横坐标 值，供当前逻辑读取或更新。 |
| 833 | simY | const | drawSimNote | 推断: BinaryExpression | 变量，在 drawSimNote 中保存 sim纵坐标 值，供当前逻辑读取或更新。 |
| 848 | time | const | drawBarNote | 推断: AsExpression | 变量，在 drawBarNote 中保存 时间 值，供当前逻辑读取或更新。 |
| 849 | lane | const | drawBarNote | 推断: AsExpression | 变量，在 drawBarNote 中保存 轨道 值，供当前逻辑读取或更新。 |
| 850 | startCol | const | drawBarNote | 推断: CallExpression | 变量，在 drawBarNote 中保存 startCol 值，供当前逻辑读取或更新。 |
| 851 | endCol | const | drawBarNote | 推断: CallExpression | 变量，在 drawBarNote 中保存 endCol 值，供当前逻辑读取或更新。 |
| 853 | i | let | drawBarNote | 推断: Identifier | 保存循环下标或对象键。 |
| 854 | x1 | const | drawBarNote | 推断: BinaryExpression | 变量，在 drawBarNote 中保存 x1 值，供当前逻辑读取或更新。 |
| 859 | x2 | const | drawBarNote | 推断: BinaryExpression | 变量，在 drawBarNote 中保存 x2 值，供当前逻辑读取或更新。 |
| 864 | y1 | const | drawBarNote | 推断: BinaryExpression | 变量，在 drawBarNote 中保存 y1 值，供当前逻辑读取或更新。 |
| 865 | y2 | const | drawBarNote | 推断: BinaryExpression | 变量，在 drawBarNote 中保存 y2 值，供当前逻辑读取或更新。 |
| 866 | w | const | drawBarNote | 推断: BinaryExpression | 变量，在 drawBarNote 中保存 w 值，供当前逻辑读取或更新。 |
| 874 | grd | const | drawBarNote | 推断: CallExpression | 变量，在 drawBarNote 中保存 grd 值，供当前逻辑读取或更新。 |
| 897 | note | const | drawNotes | 推断 | 变量，在 drawNotes 中保存 音符 值，供当前逻辑读取或更新。 |
| 934 | notes | const | drawBestdoriPreview | 推断: CallExpression | 变量，在 drawBestdoriPreview 中保存 音符列表 值，供当前逻辑读取或更新。 |
| 935 | layout | const | drawBestdoriPreview | 推断: CallExpression | 变量，在 drawBestdoriPreview 中保存 布局 值，供当前逻辑读取或更新。 |
| 936 | canvas | const | drawBestdoriPreview | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 937 | ctx | const | drawBestdoriPreview | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 938 | noteImages | const | drawBestdoriPreview | 推断: AwaitExpression | 变量，在 drawBestdoriPreview 中保存 音符图片列表 值，供当前逻辑读取或更新。 |
| 938 | coverImg | const | drawBestdoriPreview | 推断: AwaitExpression | 变量，在 drawBestdoriPreview 中保存 coverImg 值，供当前逻辑读取或更新。 |

### render-blocks/card-art.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | loadImageOnce | function | 模块顶层 | - | 推断 | 在图片布局层中加载图片Once。 |
| 55 | getCardIconFrame | function | 模块顶层 | rarity: number; attribute: 'cool' \| 'happy' \| 'pure' \| 'powerful' | Promise<Image> | 在图片布局层中获取卡牌图标Frame。 |
| 78 | getCardIllustrationFrame | function | 模块顶层 | rarity: number; attribute: 'cool' \| 'happy' \| 'pure' \| 'powerful' | Promise<Image> | 在图片布局层中获取卡牌IllustrationFrame。 |
| 112 | drawCardIcon | function | 模块顶层 | options1: DrawCardIconOptions | Promise<Canvas> | 在图片布局层中绘制卡牌图标。 |
| 198 | drawCardIllustration | function | 模块顶层 | options1: DrawCardIllustrationOptions | Promise<Canvas> | 在图片布局层中绘制卡牌Illustration。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 14 | cardTypeIconList | const | 模块顶层 | { [type: string]: Image } | 保存 卡牌类型Icon列表，用于按顺序遍历或批量渲染。 |
| 15 | starList | const | 模块顶层 | { [type: string]: Image } | 保存 star列表，用于按顺序遍历或批量渲染。 |
| 16 | limitBreakIcon | let | 模块顶层 | Image | 变量，在 模块顶层 中保存 limitBreakIcon 值，供当前逻辑读取或更新。 |
| 59 | baseUrl | const | getCardIconFrame | 推断: TemplateExpression | 保存 基础URL，用于请求接口或下载资源。 |
| 60 | imageUrl | let | getCardIconFrame | string | 保存 图片URL，用于请求接口或下载资源。 |
| 66 | imageBuffer | const | getCardIconFrame | 推断: AwaitExpression | 保存 图片缓冲区，用于二进制资源处理。 |
| 82 | baseUrl | const | getCardIllustrationFrame | 推断: TemplateExpression | 保存 基础URL，用于请求接口或下载资源。 |
| 83 | imageUrl | let | getCardIllustrationFrame | string | 保存 图片URL，用于请求接口或下载资源。 |
| 89 | imageBuffer | const | getCardIllustrationFrame | 推断: AwaitExpression | 保存 图片缓冲区，用于二进制资源处理。 |
| 94 | card | type-field | 模块顶层 | Card | 保存当前卡牌领域模型实例。 |
| 95 | trainingStatus | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 training状态 值，供当前逻辑读取或更新。 |
| 96 | illustrationTrainingStatus | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 illustrationTraining状态 值，供当前逻辑读取或更新。 |
| 97 | limitBreakRank | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 limitBreakRank 值，供当前逻辑读取或更新。 |
| 98 | level | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 等级 值，供当前逻辑读取或更新。 |
| 99 | cardIdVisible | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 卡牌IDVisible 值，供当前逻辑读取或更新。 |
| 100 | skillTypeVisible | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 技能类型Visible 值，供当前逻辑读取或更新。 |
| 101 | cardTypeVisible | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 卡牌类型Visible 值，供当前逻辑读取或更新。 |
| 102 | skillLevel | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 技能等级 值，供当前逻辑读取或更新。 |
| 124 | canvas | const | drawCardIcon | Canvas | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 127 | ctx | const | drawCardIcon | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 159 | skill | const | drawCardIcon | 推断: NewExpression | 变量，在 drawCardIcon 中保存 技能 值，供当前逻辑读取或更新。 |
| 160 | skillTypeIcon | const | drawCardIcon | 推断: AwaitExpression | 变量，在 drawCardIcon 中保存 技能类型Icon 值，供当前逻辑读取或更新。 |
| 164 | frame | const | drawCardIcon | 推断: AwaitExpression | 变量，在 drawCardIcon 中保存 frame 值，供当前逻辑读取或更新。 |
| 166 | attributeIcon | const | drawCardIcon | 推断: AwaitExpression | 变量，在 drawCardIcon 中保存 属性Icon 值，供当前逻辑读取或更新。 |
| 168 | bandIcon | const | drawCardIcon | 推断: AwaitExpression | 变量，在 drawCardIcon 中保存 乐队Icon 值，供当前逻辑读取或更新。 |
| 178 | star | const | drawCardIcon | 推断: ElementAccessExpression | 变量，在 drawCardIcon 中保存 star 值，供当前逻辑读取或更新。 |
| 179 | i | let | drawCardIcon | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 187 | card | type-field | 模块顶层 | Card | 保存当前卡牌领域模型实例。 |
| 188 | trainingStatus | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 training状态 值，供当前逻辑读取或更新。 |
| 189 | isList | type-field | 模块顶层 | boolean | 保存 is列表，用于按顺序遍历或批量渲染。 |
| 204 | cardIllustrationImage | const | drawCardIllustration | 推断: AwaitExpression | 保存 卡牌Illustration图片，用于图片绘制或输出。 |
| 206 | canvas | const | drawCardIllustration | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 207 | ctx | const | drawCardIllustration | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 209 | scale | const | drawCardIllustration | 推断: BinaryExpression | 变量，在 drawCardIllustration 中保存 scale 值，供当前逻辑读取或更新。 |
| 210 | illustrationCanvas | const | drawCardIllustration | 推断: NewExpression | 保存 illustration画布，用于图片绘制或输出。 |
| 211 | illustrationCtx | const | drawCardIllustration | 推断: CallExpression | 变量，在 drawCardIllustration 中保存 illustration绘图上下文 值，供当前逻辑读取或更新。 |
| 212 | illustrationHeight | const | drawCardIllustration | 推断: BinaryExpression | 变量，在 drawCardIllustration 中保存 illustration高度 值，供当前逻辑读取或更新。 |
| 222 | frame | const | drawCardIllustration | 推断: AwaitExpression | 变量，在 drawCardIllustration 中保存 frame 值，供当前逻辑读取或更新。 |
| 224 | attributeIcon | const | drawCardIllustration | 推断: AwaitExpression | 变量，在 drawCardIllustration 中保存 属性Icon 值，供当前逻辑读取或更新。 |
| 226 | bandIcon | const | drawCardIllustration | 推断: AwaitExpression | 变量，在 drawCardIllustration 中保存 乐队Icon 值，供当前逻辑读取或更新。 |
| 229 | star | const | drawCardIllustration | 推断: ElementAccessExpression | 变量，在 drawCardIllustration 中保存 star 值，供当前逻辑读取或更新。 |
| 230 | i | let | drawCardIllustration | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 236 | scale | const | drawCardIllustration | 推断: BinaryExpression | 变量，在 drawCardIllustration 中保存 scale 值，供当前逻辑读取或更新。 |
| 237 | tempCanvas | const | drawCardIllustration | 推断: NewExpression | 保存 临时画布，用于图片绘制或输出。 |
| 238 | ctx | const | drawCardIllustration | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |

### render-blocks/cutoff-chart.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | drawCutoffChart | function | 模块顶层 | cutoffList: Cutoff[]; setStartToZero: 推断; server: Server | 推断 | 在图片布局层中绘制档线谱面。 |
| 181 | drawCutoffEventTopChart | function | 模块顶层 | CutoffEventTop: CutoffEventTop; setStartToZero: 推断 | 推断 | 在图片布局层中绘制档线活动排名谱面。 |
| 196 | removeBraces | function | drawCutoffEventTopChart | text: string | string | 在图片布局层中移除Braces。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 25 | datasets | const | drawCutoffChart | 推断: ArrayLiteralExpression | 变量，在 drawCutoffChart 中保存 datasets 值，供当前逻辑读取或更新。 |
| 26 | time | const | drawCutoffChart | 推断: CallExpression | 变量，在 drawCutoffChart 中保存 时间 值，供当前逻辑读取或更新。 |
| 31 | list | const | drawCutoffChart | 推断: ArrayLiteralExpression | 变量，在 drawCutoffChart 中保存 列表 值，供当前逻辑读取或更新。 |
| 33 | onlyOne | const | drawCutoffChart | 推断: BinaryExpression | 变量，在 drawCutoffChart 中保存 onlyOne 值，供当前逻辑读取或更新。 |
| 34 | i | let | drawCutoffChart | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 35 | tempColor | const | drawCutoffChart | 推断: CallExpression | 变量，在 drawCutoffChart 中保存 临时颜色 值，供当前逻辑读取或更新。 |
| 37 | cutoff | const | drawCutoffChart | 推断: ElementAccessExpression | 变量，在 drawCutoffChart 中保存 档线 值，供当前逻辑读取或更新。 |
| 38 | tempEvent | const | drawCutoffChart | 推断: NewExpression | 变量，在 drawCutoffChart 中保存 临时活动 值，供当前逻辑读取或更新。 |
| 40 | lableName | let | drawCutoffChart | string | 变量，在 drawCutoffChart 中保存 lable名称 值，供当前逻辑读取或更新。 |
| 74 | data | let | drawCutoffChart | 推断: ArrayLiteralExpression | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 75 | history | const | drawCutoffChart | 推断: CallExpression | 变量，在 drawCutoffChart 中保存 history 值，供当前逻辑读取或更新。 |
| 78 | p | const | drawCutoffChart | 推断 | 变量，在 drawCutoffChart 中保存 p 值，供当前逻辑读取或更新。 |
| 86 | p | const | drawCutoffChart | 推断 | 变量，在 drawCutoffChart 中保存 p 值，供当前逻辑读取或更新。 |
| 110 | tempColor | const | drawCutoffChart | 推断: CallExpression | 变量，在 drawCutoffChart 中保存 临时颜色 值，供当前逻辑读取或更新。 |
| 127 | tempColor | const | drawCutoffChart | 推断: CallExpression | 变量，在 drawCutoffChart 中保存 临时颜色 值，供当前逻辑读取或更新。 |
| 140 | all | const | drawCutoffChart | 推断: ArrayLiteralExpression | 变量，在 drawCutoffChart 中保存 all 值，供当前逻辑读取或更新。 |
| 143 | data | const | drawCutoffChart | 推断: ObjectLiteralExpression | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 147 | longestTime | let | drawCutoffChart | 推断: FirstLiteralToken | 变量，在 drawCutoffChart 中保存 longest时间 值，供当前逻辑读取或更新。 |
| 148 | i | let | drawCutoffChart | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 149 | cutoff | const | drawCutoffChart | 推断: ElementAccessExpression | 变量，在 drawCutoffChart 中保存 档线 值，供当前逻辑读取或更新。 |
| 185 | datasets | const | drawCutoffEventTopChart | 推断: ArrayLiteralExpression | 变量，在 drawCutoffEventTopChart 中保存 datasets 值，供当前逻辑读取或更新。 |
| 189 | allData | const | drawCutoffEventTopChart | 推断: CallExpression | 变量，在 drawCutoffEventTopChart 中保存 all数据 值，供当前逻辑读取或更新。 |
| 197 | newText | const | removeBraces | 推断: CallExpression | 变量，在 removeBraces 中保存 new文本 值，供当前逻辑读取或更新。 |
| 200 | colorNumber | let | drawCutoffEventTopChart | 推断: FirstLiteralToken | 变量，在 drawCutoffEventTopChart 中保存 颜色数字 值，供当前逻辑读取或更新。 |
| 201 | key | const | drawCutoffEventTopChart | 推断 | 变量，在 drawCutoffEventTopChart 中保存 key 值，供当前逻辑读取或更新。 |
| 202 | tempColor | const | drawCutoffEventTopChart | 推断: CallExpression | 变量，在 drawCutoffEventTopChart 中保存 临时颜色 值，供当前逻辑读取或更新。 |
| 216 | data | const | drawCutoffEventTopChart | 推断: ObjectLiteralExpression | 保存当前接口、主数据或模型计算得到的业务数据。 |

### render-blocks/data-block.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | drawDataBlock | function | 模块顶层 | options1: DataBlockOptions | Canvas | 在图片布局层中绘制数据块。 |
| 121 | drawDataBlockHorizontal | function | 模块顶层 | options1: DataBlockOptions | Canvas | 在图片布局层中绘制数据块Horizontal。 |
| 220 | drawBannerImageCanvas | function | 模块顶层 | eventBannerImage: Image | Canvas | 在图片布局层中绘制横幅图片画布。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 7 | list | type-field | 模块顶层 | Array<Canvas \| Image> | 字段，在 模块顶层 中保存 列表 值，供当前逻辑读取或更新。 |
| 8 | BG | type-field | 模块顶层 | boolean | 模块常量，保存 BG 配置或静态映射。 |
| 9 | topLeftText | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 topLeft文本 值，供当前逻辑读取或更新。 |
| 10 | opacity | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 opacity 值，供当前逻辑读取或更新。 |
| 25 | topLeftTextHeight | const | drawDataBlock | 推断: FirstLiteralToken | 变量，在 drawDataBlock 中保存 topLeft文本高度 值，供当前逻辑读取或更新。 |
| 27 | allH | let | drawDataBlock | 推断: FirstLiteralToken | 变量，在 drawDataBlock 中保存 allH 值，供当前逻辑读取或更新。 |
| 28 | maxW | let | drawDataBlock | 推断: FirstLiteralToken | 变量，在 drawDataBlock 中保存 最大值W 值，供当前逻辑读取或更新。 |
| 32 | i | let | drawDataBlock | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 40 | tempCanvas | const | drawDataBlock | 推断: ConditionalExpression | 保存 临时画布，用于图片绘制或输出。 |
| 44 | ctx | const | drawDataBlock | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 65 | textImage | const | drawDataBlock | 推断: CallExpression | 保存 文本图片，用于图片绘制或输出。 |
| 97 | allH2 | let | drawDataBlock | 推断: FirstLiteralToken | 变量，在 drawDataBlock 中保存 allH2 值，供当前逻辑读取或更新。 |
| 105 | xStart | const | drawDataBlock | 推断: ConditionalExpression | 变量，在 drawDataBlock 中保存 横坐标Start 值，供当前逻辑读取或更新。 |
| 107 | i | let | drawDataBlock | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 126 | topLeftTextHeight | const | drawDataBlockHorizontal | 推断: FirstLiteralToken | 变量，在 drawDataBlockHorizontal 中保存 topLeft文本高度 值，供当前逻辑读取或更新。 |
| 129 | allW | let | drawDataBlockHorizontal | 推断: FirstLiteralToken | 变量，在 drawDataBlockHorizontal 中保存 allW 值，供当前逻辑读取或更新。 |
| 130 | maxH | let | drawDataBlockHorizontal | 推断: FirstLiteralToken | 变量，在 drawDataBlockHorizontal 中保存 最大值H 值，供当前逻辑读取或更新。 |
| 134 | i | let | drawDataBlockHorizontal | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 142 | tempCanvas | const | drawDataBlockHorizontal | 推断: ConditionalExpression | 保存 临时画布，用于图片绘制或输出。 |
| 146 | ctx | const | drawDataBlockHorizontal | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 166 | textImage | const | drawDataBlockHorizontal | 推断: CallExpression | 保存 文本图片，用于图片绘制或输出。 |
| 199 | allW2 | let | drawDataBlockHorizontal | 推断: FirstLiteralToken | 变量，在 drawDataBlockHorizontal 中保存 allW2 值，供当前逻辑读取或更新。 |
| 206 | i | let | drawDataBlockHorizontal | 推断: FirstLiteralToken | 保存循环下标或对象键。 |

### render-blocks/degree-badge.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | drawDegree | function | 模块顶层 | degree: Degree; server: Server; displayedServerList: Server[] | Promise<Canvas> | 在图片布局层中绘制称号。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 26 | canvas | const | drawDegree | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 27 | ctx | const | drawDegree | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 29 | degreeImage | const | drawDegree | 推断: AwaitExpression | 保存 称号图片，用于图片绘制或输出。 |
| 40 | frame | const | drawDegree | 推断: AwaitExpression | 变量，在 drawDegree 中保存 frame 值，供当前逻辑读取或更新。 |
| 46 | icon | const | drawDegree | 推断: AwaitExpression | 变量，在 drawDegree 中保存 icon 值，供当前逻辑读取或更新。 |

### render-blocks/detail-blocks.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 80 | drawBannerInfoBlock | function | 模块顶层 | options1: { banner: Image; detailList: Canvas[]; topLeftText?: string; } | 推断 | 在图片布局层中绘制横幅Info块。 |
| 102 | drawEventDataBlock | function | 模块顶层 | event: Event; displayedServerList: Server[]; topLeftText: string | 推断 | 在图片布局层中绘制活动数据块。 |
| 161 | drawGachaDataBlock | function | 模块顶层 | gacha: Gacha; topLeftText: string | 推断 | 在图片布局层中绘制卡池数据块。 |
| 180 | drawSongDataBlock | function | 模块顶层 | song: Song; text: string; displayedServerList: Server[] | 推断 | 在图片布局层中绘制歌曲数据块。 |
| 232 | drawSongMetaListDataBlock | function | 模块顶层 | withFever: boolean; song: Song; topLeftText: string; displayedServerList: Server[] | 推断 | 在图片布局层中绘制歌曲Meta列表数据块。 |
| 249 | <anonymous> | callback | drawSongMetaListDataBlock | value: SongInRank | 推断 | 作为 \`tempMetaRanking.filter\` 的回调，处理 value。 |
| 283 | drawMetaListDataBlock | function | 模块顶层 | withFever: boolean; server: Server; topLeftText: string | 推断 | 在图片布局层中绘制Meta列表数据块。 |
| 319 | drawCharacterHalfBlock | function | 模块顶层 | character: Character; displayedServerList: Server[] | Promise<Canvas> | 在图片布局层中绘制角色Half块。 |
| 406 | drawPlayerDetailBlockWithIllustration | function | 模块顶层 | player: Player | Promise<Canvas> | 在图片布局层中绘制玩家详情块WithIllustration。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 51 | songDetailSeparator | const | 模块顶层 | 推断: CallExpression | 变量，在 模块顶层 中保存 歌曲详情Separator 值，供当前逻辑读取或更新。 |
| 63 | songMetaSeparator | const | 模块顶层 | 推断: CallExpression | 变量，在 模块顶层 中保存 歌曲MetaSeparator 值，供当前逻辑读取或更新。 |
| 85 | banner | type-field | drawBannerInfoBlock | Image | 字段，在 drawBannerInfoBlock 中保存 横幅 值，供当前逻辑读取或更新。 |
| 86 | detailList | type-field | drawBannerInfoBlock | Canvas[] | 保存 详情列表，用于按顺序遍历或批量渲染。 |
| 87 | topLeftText | type-field | drawBannerInfoBlock | string | 字段，在 drawBannerInfoBlock 中保存 topLeft文本 值，供当前逻辑读取或更新。 |
| 107 | detailList | const | drawEventDataBlock | Canvas[] | 保存 详情列表，用于按顺序遍历或批量渲染。 |
| 113 | attributeList | const | drawEventDataBlock | 推断: CallExpression | 保存 属性列表，用于按顺序遍历或批量渲染。 |
| 114 | i | const | drawEventDataBlock | 推断 | 保存循环下标或对象键。 |
| 125 | characterList | const | drawEventDataBlock | 推断: CallExpression | 保存 角色列表，用于按顺序遍历或批量渲染。 |
| 126 | i | const | drawEventDataBlock | 推断 | 保存循环下标或对象键。 |
| 185 | server | const | drawSongDataBlock | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 186 | songJacketCanvas | const | drawSongDataBlock | 推断: CallExpression | 保存 歌曲封面画布，用于图片绘制或输出。 |
| 190 | songName | const | drawSongDataBlock | 推断: ElementAccessExpression | 变量，在 drawSongDataBlock 中保存 歌曲名称 值，供当前逻辑读取或更新。 |
| 191 | bandName | const | drawSongDataBlock | 推断: ElementAccessExpression | 变量，在 drawSongDataBlock 中保存 乐队名称 值，供当前逻辑读取或更新。 |
| 192 | songTipsName | const | drawSongDataBlock | 推断: CallExpression | 变量，在 drawSongDataBlock 中保存 歌曲Tips名称 值，供当前逻辑读取或更新。 |
| 193 | songNameImage | const | drawSongDataBlock | 推断: CallExpression | 保存 歌曲名称图片，用于图片绘制或输出。 |
| 198 | songDetail | let | drawSongDataBlock | 推断: TemplateExpression | 变量，在 drawSongDataBlock 中保存 歌曲详情 值，供当前逻辑读取或更新。 |
| 202 | songDetailImage | const | drawSongDataBlock | 推断: CallExpression | 保存 歌曲详情图片，用于图片绘制或输出。 |
| 207 | difficultyImage | const | drawSongDataBlock | 推断: CallExpression | 保存 难度图片，用于图片绘制或输出。 |
| 208 | rightCanvas | const | drawSongDataBlock | 推断: CallExpression | 保存 right画布，用于图片绘制或输出。 |
| 214 | canvas | const | drawSongDataBlock | 推断: CallExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 219 | ctx | const | drawSongDataBlock | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 238 | metaRanking | const | drawSongMetaListDataBlock | 推断: ObjectLiteralExpression | 变量，在 drawSongMetaListDataBlock 中保存 MetaRanking 值，供当前逻辑读取或更新。 |
| 239 | server | const | drawSongMetaListDataBlock | 推断 | 保存当前目标服务器枚举或服务器代码。 |
| 244 | songMetaRanking | const | drawSongMetaListDataBlock | 推断: ObjectLiteralExpression | 变量，在 drawSongMetaListDataBlock 中保存 歌曲MetaRanking 值，供当前逻辑读取或更新。 |
| 245 | server | const | drawSongMetaListDataBlock | 推断 | 保存当前目标服务器枚举或服务器代码。 |
| 247 | tempMetaRanking | const | drawSongMetaListDataBlock | 推断: PropertyAccessExpression | 变量，在 drawSongMetaListDataBlock 中保存 临时MetaRanking 值，供当前逻辑读取或更新。 |
| 253 | list | const | drawSongMetaListDataBlock | Array<Image \| Canvas> | 变量，在 drawSongMetaListDataBlock 中保存 列表 值，供当前逻辑读取或更新。 |
| 254 | difficulty | const | drawSongMetaListDataBlock | 推断 | 变量，在 drawSongMetaListDataBlock 中保存 难度 值，供当前逻辑读取或更新。 |
| 255 | difficultyId | const | drawSongMetaListDataBlock | 推断: CallExpression | 保存 难度ID，用于定位对应业务实体。 |
| 256 | text | let | drawSongMetaListDataBlock | 推断: StringLiteral | 变量，在 drawSongMetaListDataBlock 中保存 文本 值，供当前逻辑读取或更新。 |
| 257 | server | const | drawSongMetaListDataBlock | 推断 | 保存当前目标服务器枚举或服务器代码。 |
| 258 | tempSongMetaRanking | const | drawSongMetaListDataBlock | 推断: PropertyAccessExpression | 变量，在 drawSongMetaListDataBlock 中保存 临时歌曲MetaRanking 值，供当前逻辑读取或更新。 |
| 259 | j | let | drawSongMetaListDataBlock | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 261 | percent | let | drawSongMetaListDataBlock | 推断: BinaryExpression | 变量，在 drawSongMetaListDataBlock 中保存 percent 值，供当前逻辑读取或更新。 |
| 288 | metaRanking | const | drawMetaListDataBlock | 推断: CallExpression | 变量，在 drawMetaListDataBlock 中保存 MetaRanking 值，供当前逻辑读取或更新。 |
| 289 | maxMeta | const | drawMetaListDataBlock | 推断: PropertyAccessExpression | 变量，在 drawMetaListDataBlock 中保存 最大值Meta 值，供当前逻辑读取或更新。 |
| 290 | list | const | drawMetaListDataBlock | Array<Image \| Canvas> | 变量，在 drawMetaListDataBlock 中保存 列表 值，供当前逻辑读取或更新。 |
| 291 | max | const | drawMetaListDataBlock | 推断: FirstLiteralToken | 变量，在 drawMetaListDataBlock 中保存 最大值 值，供当前逻辑读取或更新。 |
| 292 | i | let | drawMetaListDataBlock | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 296 | song | const | drawMetaListDataBlock | 推断: NewExpression | 保存当前歌曲领域模型实例。 |
| 297 | difficultyId | const | drawMetaListDataBlock | 推断: PropertyAccessExpression | 保存 难度ID，用于定位对应业务实体。 |
| 298 | percent | const | drawMetaListDataBlock | 推断: BinaryExpression | 变量，在 drawMetaListDataBlock 中保存 percent 值，供当前逻辑读取或更新。 |
| 323 | width | const | drawCharacterHalfBlock | 推断: FirstLiteralToken | 保存当前绘制宽度。 |
| 324 | height | const | drawCharacterHalfBlock | 推断: FirstLiteralToken | 保存当前绘制高度。 |
| 325 | canvas | const | drawCharacterHalfBlock | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 326 | ctx | const | drawCharacterHalfBlock | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 328 | color | const | drawCharacterHalfBlock | 推断: ConditionalExpression | 变量，在 drawCharacterHalfBlock 中保存 颜色 值，供当前逻辑读取或更新。 |
| 342 | characterIllustration | const | drawCharacterHalfBlock | 推断: CallExpression | 变量，在 drawCharacterHalfBlock 中保存 角色Illustration 值，供当前逻辑读取或更新。 |
| 377 | list | const | drawCharacterHalfBlock | Canvas[] | 变量，在 drawCharacterHalfBlock 中保存 列表 值，供当前逻辑读取或更新。 |
| 378 | server | const | drawCharacterHalfBlock | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 382 | nameTextImage | const | drawCharacterHalfBlock | 推断: CallExpression | 保存 名称文本图片，用于图片绘制或输出。 |
| 389 | idTextImage | const | drawCharacterHalfBlock | 推断: CallExpression | 保存 ID文本图片，用于图片绘制或输出。 |
| 409 | list | const | drawPlayerDetailBlockWithIllustration | Array<Canvas \| Image> | 变量，在 drawPlayerDetailBlockWithIllustration 中保存 列表 值，供当前逻辑读取或更新。 |
| 410 | playerText | const | drawPlayerDetailBlockWithIllustration | 推断: CallExpression | 变量，在 drawPlayerDetailBlockWithIllustration 中保存 玩家文本 值，供当前逻辑读取或更新。 |
| 416 | levelText | const | drawPlayerDetailBlockWithIllustration | 推断: CallExpression | 变量，在 drawPlayerDetailBlockWithIllustration 中保存 等级文本 值，供当前逻辑读取或更新。 |
| 424 | degreeImageList | const | drawPlayerDetailBlockWithIllustration | Array<Canvas \| Image> | 保存 称号图片列表，用于按顺序遍历或批量渲染。 |
| 425 | userProfileDegreeMap | const | drawPlayerDetailBlockWithIllustration | 推断: PropertyAccessExpression | 保存 userProfile称号映射 映射，用于按键快速查找。 |
| 426 | i | const | drawPlayerDetailBlockWithIllustration | 推断 | 保存循环下标或对象键。 |
| 427 | tempDegree | const | drawPlayerDetailBlockWithIllustration | 推断: ElementAccessExpression | 变量，在 drawPlayerDetailBlockWithIllustration 中保存 临时称号 值，供当前逻辑读取或更新。 |
| 437 | introductionText | const | drawPlayerDetailBlockWithIllustration | 推断: CallExpression | 变量，在 drawPlayerDetailBlockWithIllustration 中保存 introduction文本 值，供当前逻辑读取或更新。 |
| 445 | userId | const | drawPlayerDetailBlockWithIllustration | 推断: ConditionalExpression | 保存 userID，用于定位对应业务实体。 |
| 448 | idText | const | drawPlayerDetailBlockWithIllustration | 推断: CallExpression | 变量，在 drawPlayerDetailBlockWithIllustration 中保存 ID文本 值，供当前逻辑读取或更新。 |
| 454 | dataBlock | const | drawPlayerDetailBlockWithIllustration | 推断: CallExpression | 变量，在 drawPlayerDetailBlockWithIllustration 中保存 数据块 值，供当前逻辑读取或更新。 |
| 456 | userIllustrationData | const | drawPlayerDetailBlockWithIllustration | 推断: PropertyAccessExpression | 变量，在 drawPlayerDetailBlockWithIllustration 中保存 userIllustration数据 值，供当前逻辑读取或更新。 |
| 457 | illustrationCard | const | drawPlayerDetailBlockWithIllustration | 推断: NewExpression | 变量，在 drawPlayerDetailBlockWithIllustration 中保存 illustration卡牌 值，供当前逻辑读取或更新。 |
| 458 | illustrationImage | const | drawPlayerDetailBlockWithIllustration | 推断: AwaitExpression | 保存 illustration图片，用于图片绘制或输出。 |
| 461 | titleImage | const | drawPlayerDetailBlockWithIllustration | 推断: CallExpression | 保存 标题图片，用于图片绘制或输出。 |
| 462 | canvas | const | drawPlayerDetailBlockWithIllustration | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 463 | ctx | const | drawPlayerDetailBlockWithIllustration | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |

### render-blocks/list-frame.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 47 | drawList | function | 模块顶层 | options1: ListOptions | Canvas | 在图片布局层中绘制列表。 |
| 103 | drawTipsInList | function | 模块顶层 | options1: tipsOptions | 推断 | 在图片布局层中绘制TipsIn列表。 |
| 141 | drawListByServerList | function | 模块顶层 | content: Array<string \| null>; key: string; serverList: Server[]; maxWidth: 推断 | 推断 | 在图片布局层中绘制列表By服务器列表。 |
| 206 | drawListMerge | function | 模块顶层 | imageList: Array<Canvas \| Image> | Canvas | 在图片布局层中绘制列表Merge。 |
| 233 | drawImageListCenter | function | 模块顶层 | imageList: Array<Canvas \| Image>; maxWidth: 推断 | Canvas | 在图片布局层中绘制图片列表Center。 |
| 250 | newLine | function | drawImageListCenter | - | 推断 | 在图片布局层中处理new线条。 |
| 315 | drawListWithLine | function | 模块顶层 | textImageList: Array<Canvas \| Image> | Canvas | 在图片布局层中绘制列表With线条。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 17 | line | const | 模块顶层 | Canvas | 变量，在 模块顶层 中保存 line 值，供当前逻辑读取或更新。 |
| 30 | key | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 key 值，供当前逻辑读取或更新。 |
| 31 | text | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本 值，供当前逻辑读取或更新。 |
| 32 | content | type-field | 模块顶层 | Array<string \| Canvas \| Image> | 字段，在 模块顶层 中保存 content 值，供当前逻辑读取或更新。 |
| 33 | textSize | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 文本Size 值，供当前逻辑读取或更新。 |
| 34 | lineHeight | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 line高度 值，供当前逻辑读取或更新。 |
| 35 | spacing | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 spacing 值，供当前逻辑读取或更新。 |
| 36 | color | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 颜色 值，供当前逻辑读取或更新。 |
| 37 | maxWidth | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 最大值宽度 值，供当前逻辑读取或更新。 |
| 57 | xmax | const | drawList | 推断: BinaryExpression | 变量，在 drawList 中保存 xmax 值，供当前逻辑读取或更新。 |
| 58 | keyImage | const | drawList | 推断: CallExpression | 保存 key图片，用于图片绘制或输出。 |
| 63 | textImage | let | drawList | Canvas | 保存 文本图片，用于图片绘制或输出。 |
| 81 | ymax | const | drawList | 推断: BinaryExpression | 变量，在 drawList 中保存 ymax 值，供当前逻辑读取或更新。 |
| 82 | canvas | const | drawList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 83 | ctx | const | drawList | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 92 | text | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本 值，供当前逻辑读取或更新。 |
| 93 | content | type-field | 模块顶层 | Array<string \| Canvas \| Image> | 字段，在 模块顶层 中保存 content 值，供当前逻辑读取或更新。 |
| 94 | textSize | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 文本Size 值，供当前逻辑读取或更新。 |
| 95 | lineHeight | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 line高度 值，供当前逻辑读取或更新。 |
| 96 | spacing | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 spacing 值，供当前逻辑读取或更新。 |
| 110 | xmax | const | drawTipsInList | 推断: FirstLiteralToken | 变量，在 drawTipsInList 中保存 xmax 值，供当前逻辑读取或更新。 |
| 111 | textImage | let | drawTipsInList | Canvas | 保存 文本图片，用于图片绘制或输出。 |
| 125 | canvas | const | drawTipsInList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 126 | ctx | const | drawTipsInList | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 147 | tempcontent | const | drawListByServerList | Array<string \| Image \| Canvas> | 变量，在 drawListByServerList 中保存 tempcontent 值，供当前逻辑读取或更新。 |
| 150 | contentMap | const | drawListByServerList | 推断: NewExpression | 保存 content映射 映射，用于按键快速查找。 |
| 153 | i | let | drawListByServerList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 154 | tempServer | const | drawListByServerList | 推断: ElementAccessExpression | 变量，在 drawListByServerList 中保存 临时服务器 值，供当前逻辑读取或更新。 |
| 155 | serverContent | const | drawListByServerList | 推断: ElementAccessExpression | 变量，在 drawListByServerList 中保存 服务器Content 值，供当前逻辑读取或更新。 |
| 167 | serverContent | const | drawListByServerList | 推断 | 变量，在 drawListByServerList 中保存 服务器Content 值，供当前逻辑读取或更新。 |
| 167 | servers | const | drawListByServerList | 推断 | 变量，在 drawListByServerList 中保存 服务器列表 值，供当前逻辑读取或更新。 |
| 170 | i | let | drawListByServerList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 181 | tempServer | const | drawListByServerList | 推断: CallExpression | 变量，在 drawListByServerList 中保存 临时服务器 值，供当前逻辑读取或更新。 |
| 190 | canvas | const | drawListByServerList | 推断: CallExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 207 | maxHeight | let | drawListMerge | 推断: FirstLiteralToken | 变量，在 drawListMerge 中保存 最大值高度 值，供当前逻辑读取或更新。 |
| 208 | i | let | drawListMerge | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 209 | element | const | drawListMerge | 推断: ElementAccessExpression | 变量，在 drawListMerge 中保存 element 值，供当前逻辑读取或更新。 |
| 214 | canvas | const | drawListMerge | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 215 | ctx | const | drawListMerge | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 216 | x | let | drawListMerge | 推断: FirstLiteralToken | 保存当前横向绘制坐标。 |
| 217 | i | let | drawListMerge | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 218 | element | const | drawListMerge | 推断: ElementAccessExpression | 变量，在 drawListMerge 中保存 element 值，供当前逻辑读取或更新。 |
| 238 | imageList | type-field | drawImageListCenter | Array<Canvas \| Image> | 保存 图片列表，用于按顺序遍历或批量渲染。 |
| 239 | width | type-field | drawImageListCenter | number | 保存当前绘制宽度。 |
| 240 | height | type-field | drawImageListCenter | number | 保存当前绘制高度。 |
| 242 | lineList | const | drawImageListCenter | Array<imageLine> | 保存 line列表，用于按顺序遍历或批量渲染。 |
| 243 | tempWidth | let | drawImageListCenter | 推断: FirstLiteralToken | 变量，在 drawImageListCenter 中保存 临时宽度 值，供当前逻辑读取或更新。 |
| 244 | tempHeight | let | drawImageListCenter | 推断: FirstLiteralToken | 变量，在 drawImageListCenter 中保存 临时高度 值，供当前逻辑读取或更新。 |
| 245 | tempImageList | let | drawImageListCenter | Array<Canvas \| Image> | 保存 临时图片列表，用于按顺序遍历或批量渲染。 |
| 264 | i | let | drawImageListCenter | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 265 | element | const | drawImageListCenter | 推断: ElementAccessExpression | 变量，在 drawImageListCenter 中保存 element 值，供当前逻辑读取或更新。 |
| 285 | Height | let | drawImageListCenter | 推断: FirstLiteralToken | 变量，在 drawImageListCenter 中保存 高度 值，供当前逻辑读取或更新。 |
| 286 | i | let | drawImageListCenter | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 287 | element | const | drawImageListCenter | 推断: ElementAccessExpression | 变量，在 drawImageListCenter 中保存 element 值，供当前逻辑读取或更新。 |
| 290 | canvas | const | drawImageListCenter | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 291 | ctx | const | drawImageListCenter | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 293 | middleWidth | const | drawImageListCenter | 推断: BinaryExpression | 变量，在 drawImageListCenter 中保存 middle宽度 值，供当前逻辑读取或更新。 |
| 294 | y | let | drawImageListCenter | 推断: FirstLiteralToken | 保存当前纵向绘制坐标。 |
| 295 | i | let | drawImageListCenter | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 296 | element | const | drawImageListCenter | 推断: ElementAccessExpression | 变量，在 drawImageListCenter 中保存 element 值，供当前逻辑读取或更新。 |
| 297 | x | let | drawImageListCenter | 推断: BinaryExpression | 保存当前横向绘制坐标。 |
| 298 | j | let | drawImageListCenter | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 299 | image | const | drawImageListCenter | 推断: ElementAccessExpression | 保存当前加载或绘制的图片对象。 |
| 316 | x | const | drawListWithLine | 推断: FirstLiteralToken | 保存当前横向绘制坐标。 |
| 317 | y | let | drawListWithLine | 推断: FirstLiteralToken | 保存当前纵向绘制坐标。 |
| 318 | height | let | drawListWithLine | 推断: FirstLiteralToken | 保存当前绘制高度。 |
| 319 | i | let | drawListWithLine | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 320 | element | const | drawListWithLine | 推断: ElementAccessExpression | 变量，在 drawListWithLine 中保存 element 值，供当前逻辑读取或更新。 |
| 323 | canvas | const | drawListWithLine | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 324 | ctx | const | drawListWithLine | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 327 | i | let | drawListWithLine | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 328 | element | const | drawListWithLine | 推断: ElementAccessExpression | 变量，在 drawListWithLine 中保存 element 值，供当前逻辑读取或更新。 |

### render-blocks/list-attribute.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | drawAttributeInList | function | 模块顶层 | options1: AttributeInListOptions | Promise<Canvas> | 在图片布局层中绘制属性In列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 6 | key | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 key 值，供当前逻辑读取或更新。 |
| 7 | content | type-field | 模块顶层 | Array<Attribute> | 字段，在 模块顶层 中保存 content 值，供当前逻辑读取或更新。 |
| 8 | text | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本 值，供当前逻辑读取或更新。 |
| 21 | list | const | drawAttributeInList | Array<string \| Image \| Canvas> | 变量，在 drawAttributeInList 中保存 列表 值，供当前逻辑读取或更新。 |
| 25 | canvas | const | drawAttributeInList | 推断: CallExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 33 | canvas | const | drawAttributeInList | 推断: CallExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |

### render-blocks/list-band-detail.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 28 | drawBandDetailsInList | function | 模块顶层 | BandDetailsInListOptions: drawBandDetailsInListOptions; key: string | 推断 | 在图片布局层中绘制乐队详情列表In列表。 |
| 74 | drawPlayerBandRankInList | function | 模块顶层 | player: Player; key: string | Promise<Canvas> | 在图片布局层中绘制玩家乐队RankIn列表。 |
| 98 | drawPlayerStageChallengeRankInList | function | 模块顶层 | player: Player; key: string | Promise<Canvas> | 在图片布局层中绘制玩家试炼ChallengeRankIn列表。 |
| 124 | loadRankImage | function | 模块顶层 | rankImageName: string | Promise<Image> | 在图片布局层中加载Rank图片。 |
| 145 | drawPlayerDeckTotalRatingInList | function | 模块顶层 | player: Player; key: string | 推断 | 在图片布局层中绘制玩家DeckTotalRatingIn列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 32 | bandAndContentList | const | drawBandDetailsInList | Array<Canvas> | 保存 乐队AndContent列表，用于按顺序遍历或批量渲染。 |
| 33 | i | const | drawBandDetailsInList | 推断 | 保存循环下标或对象键。 |
| 34 | tempBand | const | drawBandDetailsInList | 推断: NewExpression | 变量，在 drawBandDetailsInList 中保存 临时乐队 值，供当前逻辑读取或更新。 |
| 35 | content | const | drawBandDetailsInList | 推断: ElementAccessExpression | 变量，在 drawBandDetailsInList 中保存 content 值，供当前逻辑读取或更新。 |
| 36 | maxWidth | const | drawBandDetailsInList | 推断: FirstLiteralToken | 变量，在 drawBandDetailsInList 中保存 最大值宽度 值，供当前逻辑读取或更新。 |
| 37 | logoWidth | const | drawBandDetailsInList | 推断: FirstLiteralToken | 变量，在 drawBandDetailsInList 中保存 logo宽度 值，供当前逻辑读取或更新。 |
| 38 | tempBandIcon | const | drawBandDetailsInList | 推断: CallExpression | 变量，在 drawBandDetailsInList 中保存 临时乐队Icon 值，供当前逻辑读取或更新。 |
| 42 | canvas | const | drawBandDetailsInList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 43 | ctx | const | drawBandDetailsInList | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 45 | tempBandRankText | const | drawBandDetailsInList | 推断: CallExpression | 变量，在 drawBandDetailsInList 中保存 临时乐队Rank文本 值，供当前逻辑读取或更新。 |
| 57 | bandAndContentListImage | const | drawBandDetailsInList | 推断: CallExpression | 保存 乐队AndContent列表图片，用于图片绘制或输出。 |
| 78 | bandRankMap | const | drawPlayerBandRankInList | 推断: PropertyAccessExpression | 保存 乐队Rank映射 映射，用于按键快速查找。 |
| 79 | BandDetails | const | drawPlayerBandRankInList | 推断: ObjectLiteralExpression | 变量，在 drawPlayerBandRankInList 中保存 乐队详情列表 值，供当前逻辑读取或更新。 |
| 80 | i | const | drawPlayerBandRankInList | 推断 | 保存循环下标或对象键。 |
| 102 | stageChallengeAchievementConditionsMap | const | drawPlayerStageChallengeRankInList | 推断: PropertyAccessExpression | 保存 试炼ChallengeAchievementConditions映射 映射，用于按键快速查找。 |
| 105 | BandDetails | const | drawPlayerStageChallengeRankInList | 推断: ObjectLiteralExpression | 变量，在 drawPlayerStageChallengeRankInList 中保存 乐队详情列表 值，供当前逻辑读取或更新。 |
| 106 | band | const | drawPlayerStageChallengeRankInList | 推断 | 变量，在 drawPlayerStageChallengeRankInList 中保存 乐队 值，供当前逻辑读取或更新。 |
| 107 | level | const | drawPlayerStageChallengeRankInList | 推断: BinaryExpression | 变量，在 drawPlayerStageChallengeRankInList 中保存 等级 值，供当前逻辑读取或更新。 |
| 117 | rankImage | const | 模块顶层 | { [rankImageName: string]: Image } | 保存 rank图片，用于图片绘制或输出。 |
| 149 | userDeckTotalRatingMap | const | drawPlayerDeckTotalRatingInList | 推断: PropertyAccessExpression | 保存 userDeckTotalRating映射 映射，用于按键快速查找。 |
| 150 | BandDetails | const | drawPlayerDeckTotalRatingInList | 推断: ObjectLiteralExpression | 变量，在 drawPlayerDeckTotalRatingInList 中保存 乐队详情列表 值，供当前逻辑读取或更新。 |
| 152 | i | const | drawPlayerDeckTotalRatingInList | 推断 | 保存循环下标或对象键。 |
| 154 | rankName | const | drawPlayerDeckTotalRatingInList | 推断: PropertyAccessExpression | 变量，在 drawPlayerDeckTotalRatingInList 中保存 rank名称 值，供当前逻辑读取或更新。 |
| 155 | rankId | let | drawPlayerDeckTotalRatingInList | 推断: ElementAccessExpression | 保存 rankID，用于定位对应业务实体。 |
| 156 | rankImage | const | drawPlayerDeckTotalRatingInList | 推断: AwaitExpression | 保存 rank图片，用于图片绘制或输出。 |
| 157 | widthMax | const | drawPlayerDeckTotalRatingInList | 推断: FirstLiteralToken | 变量，在 drawPlayerDeckTotalRatingInList 中保存 宽度最大值 值，供当前逻辑读取或更新。 |
| 158 | heightMax | const | drawPlayerDeckTotalRatingInList | 推断: FirstLiteralToken | 变量，在 drawPlayerDeckTotalRatingInList 中保存 高度最大值 值，供当前逻辑读取或更新。 |
| 159 | canvas | const | drawPlayerDeckTotalRatingInList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 160 | ctx | const | drawPlayerDeckTotalRatingInList | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 167 | rankLevelImage | const | drawPlayerDeckTotalRatingInList | 推断: CallExpression | 保存 rank等级图片，用于图片绘制或输出。 |

### render-blocks/list-band.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | drawBandInList | function | 模块顶层 | options1: BandInListOptions | Promise<Canvas> | 在图片布局层中绘制乐队In列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 7 | key | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 key 值，供当前逻辑读取或更新。 |
| 8 | content | type-field | 模块顶层 | Array<Band> | 字段，在 模块顶层 中保存 content 值，供当前逻辑读取或更新。 |
| 9 | text | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本 值，供当前逻辑读取或更新。 |
| 22 | server | const | drawBandInList | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 23 | list | const | drawBandInList | Array<string \| Image \| Canvas> | 变量，在 drawBandInList 中保存 列表 值，供当前逻辑读取或更新。 |
| 29 | canvas | const | drawBandInList | 推断: CallExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 35 | i | let | drawBandInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 36 | band | const | drawBandInList | 推断: ElementAccessExpression | 变量，在 drawBandInList 中保存 乐队 值，供当前逻辑读取或更新。 |
| 46 | canvas | const | drawBandInList | 推断: CallExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |

### render-blocks/list-card-icon-list.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 22 | drawCardListInList | function | 模块顶层 | options1: CardIconInListOptions | 推断 | 在图片布局层中绘制卡牌列表In列表。 |
| 33 | <anonymous> | callback | drawCardListInList | a: 推断; b: 推断 | 推断 | 作为 \`cardList.sort\` 的回调，处理 a、b。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 8 | key | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 key 值，供当前逻辑读取或更新。 |
| 9 | cardList | type-field | 模块顶层 | Array<Card> | 保存 卡牌列表，用于按顺序遍历或批量渲染。 |
| 10 | cardIdVisible | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 卡牌IDVisible 值，供当前逻辑读取或更新。 |
| 11 | skillTypeVisible | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 技能类型Visible 值，供当前逻辑读取或更新。 |
| 12 | cardTypeVisible | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 卡牌类型Visible 值，供当前逻辑读取或更新。 |
| 13 | trainingStatus | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 training状态 值，供当前逻辑读取或更新。 |
| 14 | lineHeight | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 line高度 值，供当前逻辑读取或更新。 |
| 32 | typeList | const | drawCardListInList | readonly string[] | 保存 类型列表，用于按顺序遍历或批量渲染。 |
| 50 | textSize | const | drawCardListInList | 推断: BinaryExpression | 变量，在 drawCardListInList 中保存 文本Size 值，供当前逻辑读取或更新。 |
| 51 | spacing | const | drawCardListInList | 推断: BinaryExpression | 变量，在 drawCardListInList 中保存 spacing 值，供当前逻辑读取或更新。 |
| 52 | list | const | drawCardListInList | Array<Canvas> | 变量，在 drawCardListInList 中保存 列表 值，供当前逻辑读取或更新。 |
| 53 | i | let | drawCardListInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 54 | element | const | drawCardListInList | Card | 变量，在 drawCardListInList 中保存 element 值，供当前逻辑读取或更新。 |
| 55 | cardIcon | let | drawCardListInList | Canvas | 变量，在 drawCardListInList 中保存 卡牌Icon 值，供当前逻辑读取或更新。 |
| 66 | getTrainingStatusList | const | drawCardListInList | 推断: CallExpression | 保存 getTraining状态列表，用于按顺序遍历或批量渲染。 |
| 67 | j | let | drawCardListInList | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |

### render-blocks/list-card-prefix.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | loadImageOnce | function | 模块顶层 | - | 推断 | 在图片布局层中加载图片Once。 |
| 33 | drawCardPrefixInList | function | 模块顶层 | card: Card; displayedServerList: Server[] | 推断 | 在图片布局层中绘制卡牌PrefixIn列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 13 | prefixBG | let | 模块顶层 | Canvas | 变量，在 模块顶层 中保存 prefixBG 值，供当前逻辑读取或更新。 |
| 37 | canvas | const | drawCardPrefixInList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 38 | ctx | const | drawCardPrefixInList | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 42 | band | const | drawCardPrefixInList | 推断: NewExpression | 变量，在 drawCardPrefixInList 中保存 乐队 值，供当前逻辑读取或更新。 |
| 43 | bandLogo | const | drawCardPrefixInList | 推断: AwaitExpression | 变量，在 drawCardPrefixInList 中保存 乐队Logo 值，供当前逻辑读取或更新。 |
| 53 | server | const | drawCardPrefixInList | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 61 | character | const | drawCardPrefixInList | 推断: NewExpression | 保存当前角色领域模型实例。 |
| 62 | tempserver | const | drawCardPrefixInList | 推断: CallExpression | 变量，在 drawCardPrefixInList 中保存 tempserver 值，供当前逻辑读取或更新。 |
| 66 | characterName | const | drawCardPrefixInList | 推断: ElementAccessExpression | 变量，在 drawCardPrefixInList 中保存 角色名称 值，供当前逻辑读取或更新。 |

### render-blocks/list-card-sd-character.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 12 | drawSdCharacterInList | function | 模块顶层 | card: Card | Promise<Canvas> | 在图片布局层中绘制SD角色In列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 13 | costumeId | const | drawSdCharacterInList | 推断: PropertyAccessExpression | 保存 服装ID，用于定位对应业务实体。 |
| 14 | costume | const | drawSdCharacterInList | 推断: NewExpression | 变量，在 drawSdCharacterInList 中保存 服装 值，供当前逻辑读取或更新。 |
| 16 | sdCharacterImage | const | drawSdCharacterInList | 推断: AwaitExpression | 保存 sd角色图片，用于图片绘制或输出。 |
| 18 | sdCharacterImageList | const | drawSdCharacterInList | Array<Canvas> | 保存 sd角色图片列表，用于按顺序遍历或批量渲染。 |
| 19 | i | let | drawSdCharacterInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 20 | canvas | const | drawSdCharacterInList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 21 | context | const | drawSdCharacterInList | 推断: CallExpression | 变量，在 drawSdCharacterInList 中保存 context 值，供当前逻辑读取或更新。 |
| 22 | x | const | drawSdCharacterInList | 推断: ConditionalExpression | 保存当前横向绘制坐标。 |
| 23 | y | const | drawSdCharacterInList | 推断: ConditionalExpression | 保存当前纵向绘制坐标。 |

### render-blocks/list-character-detail.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | drawCharacterInList | function | 模块顶层 | CharacterDetailsInListOptions: drawBandDetailsInListOptions; key: string | 推断 | 在图片布局层中绘制角色In列表。 |
| 64 | drawCharacterRankInList | function | 模块顶层 | player: Player; key: string | 推断 | 在图片布局层中绘制角色RankIn列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 23 | characterAndContentList | const | drawCharacterInList | Array<Canvas> | 保存 角色AndContent列表，用于按顺序遍历或批量渲染。 |
| 24 | i | const | drawCharacterInList | 推断 | 保存循环下标或对象键。 |
| 25 | tempCharacter | const | drawCharacterInList | 推断: NewExpression | 变量，在 drawCharacterInList 中保存 临时角色 值，供当前逻辑读取或更新。 |
| 26 | content | const | drawCharacterInList | 推断: ElementAccessExpression | 变量，在 drawCharacterInList 中保存 content 值，供当前逻辑读取或更新。 |
| 27 | maxWidth | const | drawCharacterInList | 推断: FirstLiteralToken | 变量，在 drawCharacterInList 中保存 最大值宽度 值，供当前逻辑读取或更新。 |
| 28 | logoWidth | const | drawCharacterInList | 推断: FirstLiteralToken | 变量，在 drawCharacterInList 中保存 logo宽度 值，供当前逻辑读取或更新。 |
| 29 | tempCharacterIcon | const | drawCharacterInList | 推断: CallExpression | 变量，在 drawCharacterInList 中保存 临时角色Icon 值，供当前逻辑读取或更新。 |
| 33 | canvas | const | drawCharacterInList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 34 | ctx | const | drawCharacterInList | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 36 | tempCharacterRankText | const | drawCharacterInList | 推断: CallExpression | 变量，在 drawCharacterInList 中保存 临时角色Rank文本 值，供当前逻辑读取或更新。 |
| 48 | characterAndContentListImage | const | drawCharacterInList | 推断: CallExpression | 保存 角色AndContent列表图片，用于图片绘制或输出。 |
| 65 | characterRankMap | const | drawCharacterRankInList | 推断: PropertyAccessExpression | 保存 角色Rank映射 映射，用于按键快速查找。 |
| 66 | CharacterDetailsInListOptions | const | drawCharacterRankInList | 推断: ObjectLiteralExpression | 变量，在 drawCharacterRankInList 中保存 角色详情列表In列表选项 值，供当前逻辑读取或更新。 |
| 67 | i | const | drawCharacterRankInList | 推断 | 保存循环下标或对象键。 |
| 74 | characterRankInList | const | drawCharacterRankInList | 推断: AwaitExpression | 保存 角色RankIn列表，用于按顺序遍历或批量渲染。 |

### render-blocks/list-character.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 22 | drawCharacterInList | function | 模块顶层 | options1: CharacterInListOptions; displayedServerList: Server[] | Promise<Canvas> | 在图片布局层中绘制角色In列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 11 | key | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 key 值，供当前逻辑读取或更新。 |
| 12 | content | type-field | 模块顶层 | Array<Character> | 字段，在 模块顶层 中保存 content 值，供当前逻辑读取或更新。 |
| 13 | text | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本 值，供当前逻辑读取或更新。 |
| 26 | server | const | drawCharacterInList | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 30 | list | const | drawCharacterInList | Array<string \| Image \| Canvas> | 变量，在 drawCharacterInList 中保存 列表 值，供当前逻辑读取或更新。 |
| 34 | canvas | const | drawCharacterInList | 推断: CallExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 40 | i | let | drawCharacterInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 41 | character | const | drawCharacterInList | 推断: ElementAccessExpression | 保存当前角色领域模型实例。 |
| 47 | canvas | const | drawCharacterInList | 推断: CallExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |

### render-blocks/list-degree-list.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 26 | drawDegreeListInList | function | 模块顶层 | options1: DegreeListInListOptions | Promise<Canvas> | 在图片布局层中绘制称号列表In列表。 |
| 51 | drawDegreeListOfEvent | function | 模块顶层 | event: Event; displayedServerList: Server[] | Promise<Canvas> | 在图片布局层中绘制称号列表Of活动。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 14 | key | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 key 值，供当前逻辑读取或更新。 |
| 15 | degreeList | type-field | 模块顶层 | Array<Degree> | 保存 称号列表，用于按顺序遍历或批量渲染。 |
| 16 | server | type-field | 模块顶层 | Server | 保存当前目标服务器枚举或服务器代码。 |
| 17 | displayedServerList | type-field | 模块顶层 | Server[] | 保存当前允许展示或下载资源的服务器优先级列表。 |
| 31 | list | const | drawDegreeListInList | Array<Canvas> | 变量，在 drawDegreeListInList 中保存 列表 值，供当前逻辑读取或更新。 |
| 32 | i | let | drawDegreeListInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 33 | element | const | drawDegreeListInList | 推断: ElementAccessExpression | 变量，在 drawDegreeListInList 中保存 element 值，供当前逻辑读取或更新。 |
| 34 | degreeImage | const | drawDegreeListInList | 推断: AwaitExpression | 保存 称号图片，用于图片绘制或输出。 |
| 56 | list | const | drawDegreeListOfEvent | 推断: ArrayLiteralExpression | 变量，在 drawDegreeListOfEvent 中保存 列表 值，供当前逻辑读取或更新。 |
| 57 | tempDegreeList | const | drawDegreeListOfEvent | 推断: ArrayLiteralExpression | 保存 临时称号列表，用于按顺序遍历或批量渲染。 |
| 58 | server | const | drawDegreeListOfEvent | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 59 | rankingRewards | const | drawDegreeListOfEvent | 推断: ElementAccessExpression | 变量，在 drawDegreeListOfEvent 中保存 ranking奖励列表 值，供当前逻辑读取或更新。 |
| 60 | i | let | drawDegreeListOfEvent | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 79 | rewards | const | drawDegreeListOfEvent | 推断: ElementAccessExpression | 变量，在 drawDegreeListOfEvent 中保存 奖励列表 值，供当前逻辑读取或更新。 |
| 80 | i | let | drawDegreeListOfEvent | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 81 | tempDegreeList | const | drawDegreeListOfEvent | 推断: ArrayLiteralExpression | 保存 临时称号列表，用于按顺序遍历或批量渲染。 |
| 82 | n | let | drawDegreeListOfEvent | 推断: FirstLiteralToken | 变量，在 drawDegreeListOfEvent 中保存 n 值，供当前逻辑读取或更新。 |
| 102 | tempDegreeList | const | drawDegreeListOfEvent | 推断: ArrayLiteralExpression | 保存 临时称号列表，用于按顺序遍历或批量渲染。 |
| 103 | data | const | drawDegreeListOfEvent | 推断: AwaitExpression | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 104 | rewards | const | drawDegreeListOfEvent | 推断: ElementAccessExpression | 变量，在 drawDegreeListOfEvent 中保存 奖励列表 值，供当前逻辑读取或更新。 |
| 105 | i | const | drawDegreeListOfEvent | 推断 | 保存循环下标或对象键。 |
| 107 | rewardsList | const | drawDegreeListOfEvent | 推断: ElementAccessExpression | 保存 奖励列表列表，用于按顺序遍历或批量渲染。 |
| 108 | j | const | drawDegreeListOfEvent | 推断 | 保存嵌套循环下标或对象键。 |

### render-blocks/list-difficulty-detail.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | DifficultyDetailInList | function | 模块顶层 | DifficultyDetailInListOptions: drawDifficultyDetailInListOptions; key: string | 推断 | 在图片布局层中处理难度详情In列表。 |
| 70 | drawPlayerDifficultyDetailInList | function | 模块顶层 | player: Player; type: 'clearedMusicCount' \| 'fullComboMusicCount' \| 'allPerfectMusicCount'; key: string | 推断 | 在图片布局层中绘制玩家难度详情In列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 25 | difficultyAndContentList | const | DifficultyDetailInList | Array<Canvas> | 保存 难度AndContent列表，用于按顺序遍历或批量渲染。 |
| 26 | i | const | DifficultyDetailInList | 推断 | 保存循环下标或对象键。 |
| 27 | content | const | DifficultyDetailInList | 推断: ElementAccessExpression | 变量，在 DifficultyDetailInList 中保存 content 值，供当前逻辑读取或更新。 |
| 28 | maxWidth | const | DifficultyDetailInList | 推断: FirstLiteralToken | 变量，在 DifficultyDetailInList 中保存 最大值宽度 值，供当前逻辑读取或更新。 |
| 29 | logoWidth | const | DifficultyDetailInList | 推断: FirstLiteralToken | 变量，在 DifficultyDetailInList 中保存 logo宽度 值，供当前逻辑读取或更新。 |
| 30 | tempBandIcon | const | DifficultyDetailInList | 推断: CallExpression | 变量，在 DifficultyDetailInList 中保存 临时乐队Icon 值，供当前逻辑读取或更新。 |
| 38 | tempBandRankText | const | DifficultyDetailInList | 推断: CallExpression | 变量，在 DifficultyDetailInList 中保存 临时乐队Rank文本 值，供当前逻辑读取或更新。 |
| 43 | canvas | const | DifficultyDetailInList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 44 | ctx | const | DifficultyDetailInList | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 53 | difficultyAndContentListImage | const | DifficultyDetailInList | 推断: CallExpression | 保存 难度AndContent列表图片，用于图片绘制或输出。 |
| 75 | DifficultyDetailInListOptions | const | drawPlayerDifficultyDetailInList | 推断: ObjectLiteralExpression | 变量，在 drawPlayerDifficultyDetailInList 中保存 难度详情In列表选项 值，供当前逻辑读取或更新。 |
| 76 | userMusicClearInfoMap | const | drawPlayerDifficultyDetailInList | 推断: PropertyAccessExpression | 保存 user音乐ClearInfo映射 映射，用于按键快速查找。 |
| 77 | difficultyName | const | drawPlayerDifficultyDetailInList | 推断 | 变量，在 drawPlayerDifficultyDetailInList 中保存 难度名称 值，供当前逻辑读取或更新。 |
| 84 | element | const | drawPlayerDifficultyDetailInList | 推断: ElementAccessExpression | 变量，在 drawPlayerDifficultyDetailInList 中保存 element 值，供当前逻辑读取或更新。 |
| 85 | difficultyId | const | drawPlayerDifficultyDetailInList | 推断: CallExpression | 保存 难度ID，用于定位对应业务实体。 |
| 86 | content | const | drawPlayerDifficultyDetailInList | 推断: ArrayLiteralExpression | 变量，在 drawPlayerDifficultyDetailInList 中保存 content 值，供当前逻辑读取或更新。 |

### render-blocks/list-difficulty.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 14 | drawDifficultyList | function | 模块顶层 | song: Song; imageHeight: number; spacing: number | Canvas | 在图片布局层中绘制难度列表。 |
| 43 | drawDifficulty | function | 模块顶层 | difficultyType: number; playLevel: number; imageHeight: number | 推断 | 在图片布局层中绘制难度。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 19 | difficultyCount | const | drawDifficultyList | 推断: PropertyAccessExpression | 变量，在 drawDifficultyList 中保存 难度数量 值，供当前逻辑读取或更新。 |
| 20 | canvas | const | drawDifficultyList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 24 | ctx | const | drawDifficultyList | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 25 | d | const | drawDifficultyList | 推断 | 变量，在 drawDifficultyList 中保存 d 值，供当前逻辑读取或更新。 |
| 26 | i | const | drawDifficultyList | 推断: CallExpression | 保存循环下标或对象键。 |
| 48 | tempCanvas | const | drawDifficulty | 推断: NewExpression | 保存 临时画布，用于图片绘制或输出。 |
| 49 | ctx | const | drawDifficulty | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 57 | levelText | const | drawDifficulty | 推断: CallExpression | 变量，在 drawDifficulty 中保存 等级文本 值，供当前逻辑读取或更新。 |

### render-blocks/list-event-stage.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 29 | loadStageTypeTopImage | function | 模块顶层 | type: string | Promise<Image> | 在图片布局层中加载试炼类型排名图片。 |
| 47 | drawEventStageTypeTop | function | 模块顶层 | stage: Stage | Promise<Canvas> | 在图片布局层中绘制活动试炼类型排名。 |
| 96 | drawSongInEventStageSongHorizontal | function | 模块顶层 | song: Song; meta: boolean | Promise<Canvas> | 在图片布局层中绘制歌曲In活动试炼歌曲Horizontal。 |
| 126 | drawDifficultyLineGraph | function | drawSongInEventStageSongHorizontal | difficultyId: number | Canvas | 在图片布局层中绘制难度线条Graph。 |
| 161 | drawEventStageSongHorizontal | function | 模块顶层 | stage: Stage; meta: boolean | Promise<Canvas> | 在图片布局层中绘制活动试炼歌曲Horizontal。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 21 | stageTypeTopImageList | const | 模块顶层 | { [type: string]: Image } | 保存 试炼类型Top图片列表，用于按顺序遍历或批量渲染。 |
| 49 | type | let | drawEventStageTypeTop | 推断: PropertyAccessExpression | 变量，在 drawEventStageTypeTop 中保存 类型 值，供当前逻辑读取或更新。 |
| 50 | startAt | const | drawEventStageTypeTop | 推断: PropertyAccessExpression | 变量，在 drawEventStageTypeTop 中保存 startAt 值，供当前逻辑读取或更新。 |
| 51 | endAt | const | drawEventStageTypeTop | 推断: PropertyAccessExpression | 变量，在 drawEventStageTypeTop 中保存 endAt 值，供当前逻辑读取或更新。 |
| 56 | eventStageTypeTopImage | const | drawEventStageTypeTop | 推断: AwaitExpression | 保存 活动试炼类型Top图片，用于图片绘制或输出。 |
| 58 | typeName | const | drawEventStageTypeTop | 推断: ElementAccessExpression | 变量，在 drawEventStageTypeTop 中保存 类型名称 值，供当前逻辑读取或更新。 |
| 59 | timeText | const | drawEventStageTypeTop | 推断: TemplateExpression | 变量，在 drawEventStageTypeTop 中保存 时间文本 值，供当前逻辑读取或更新。 |
| 61 | canvas | const | drawEventStageTypeTop | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 65 | ctx | const | drawEventStageTypeTop | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 82 | presentEventMark | const | drawEventStageTypeTop | 推断: AwaitExpression | 变量，在 drawEventStageTypeTop 中保存 present活动Mark 值，供当前逻辑读取或更新。 |
| 101 | canvas | const | drawSongInEventStageSongHorizontal | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 102 | ctx | const | drawSongInEventStageSongHorizontal | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 104 | jacketImageHeight | const | drawSongInEventStageSongHorizontal | 推断: BinaryExpression | 变量，在 drawSongInEventStageSongHorizontal 中保存 封面图片高度 值，供当前逻辑读取或更新。 |
| 127 | meta | const | drawDifficultyLineGraph | 推断: CallExpression | 变量，在 drawDifficultyLineGraph 中保存 Meta 值，供当前逻辑读取或更新。 |
| 128 | canvas | const | drawDifficultyLineGraph | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 129 | ctx | const | drawDifficultyLineGraph | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 141 | difficultyLineGraphList | const | drawSongInEventStageSongHorizontal | 推断: ArrayLiteralExpression | 保存 难度LineGraph列表，用于按顺序遍历或批量渲染。 |
| 142 | i | const | drawSongInEventStageSongHorizontal | 推断 | 保存循环下标或对象键。 |
| 143 | difficultyId | const | drawSongInEventStageSongHorizontal | 推断: CallExpression | 保存 难度ID，用于定位对应业务实体。 |
| 147 | difficultyLineGraph | const | drawSongInEventStageSongHorizontal | 推断: CallExpression | 变量，在 drawSongInEventStageSongHorizontal 中保存 难度LineGraph 值，供当前逻辑读取或更新。 |
| 166 | songIdList | const | drawEventStageSongHorizontal | 推断: PropertyAccessExpression | 保存 歌曲ID列表，用于按顺序遍历或批量渲染。 |
| 168 | canvas | const | drawEventStageSongHorizontal | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 169 | ctx | const | drawEventStageSongHorizontal | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 170 | i | let | drawEventStageSongHorizontal | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 171 | song | const | drawEventStageSongHorizontal | 推断: NewExpression | 保存当前歌曲领域模型实例。 |

### render-blocks/list-gacha-payment-method.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | drawGashaPaymentMethodInList | function | 模块顶层 | gacha: Gacha | 推断 | 在图片布局层中绘制Gasha支付方式MethodIn列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 7 | behaviorName | const | 模块顶层 | 推断: ObjectLiteralExpression | 变量，在 模块顶层 中保存 behavior名称 值，供当前逻辑读取或更新。 |
| 22 | list | const | drawGashaPaymentMethodInList | 推断: ArrayLiteralExpression | 变量，在 drawGashaPaymentMethodInList 中保存 列表 值，供当前逻辑读取或更新。 |
| 23 | patmentMethods | const | drawGashaPaymentMethodInList | 推断: PropertyAccessExpression | 变量，在 drawGashaPaymentMethodInList 中保存 patmentMethods 值，供当前逻辑读取或更新。 |
| 24 | i | let | drawGashaPaymentMethodInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 25 | patmentMethod | const | drawGashaPaymentMethodInList | 推断: ElementAccessExpression | 变量，在 drawGashaPaymentMethodInList 中保存 patmentMethod 值，供当前逻辑读取或更新。 |
| 26 | methodDescription | const | drawGashaPaymentMethodInList | 推断: ArrayLiteralExpression | 变量，在 drawGashaPaymentMethodInList 中保存 methodDescription 值，供当前逻辑读取或更新。 |
| 30 | itemId | let | drawGashaPaymentMethodInList | 推断: StringLiteral | 保存 道具ID，用于定位对应业务实体。 |
| 31 | costItemQuantity | const | drawGashaPaymentMethodInList | 推断: PropertyAccessExpression | 变量，在 drawGashaPaymentMethodInList 中保存 cost道具Quantity 值，供当前逻辑读取或更新。 |
| 40 | item | const | drawGashaPaymentMethodInList | 推断: NewExpression | 变量，在 drawGashaPaymentMethodInList 中保存 道具 值，供当前逻辑读取或更新。 |
| 67 | isFirst | const | drawGashaPaymentMethodInList | 推断: BinaryExpression | 布尔标记，表示 isFirst 的判断结果。 |

### render-blocks/list-gacha-pick-up.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 17 | drawGachaPickupInList | function | 模块顶层 | gacha: Gacha; server: Server; key: string | Promise<Canvas> | 在图片布局层中绘制卡池PickUpIn列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 22 | list | const | drawGachaPickupInList | 推断: ArrayLiteralExpression | 变量，在 drawGachaPickupInList 中保存 列表 值，供当前逻辑读取或更新。 |
| 28 | pickUpCardIdList | let | drawGachaPickupInList | 推断: ArrayLiteralExpression | 保存 pickUp卡牌ID列表，用于按顺序遍历或批量渲染。 |
| 29 | details | const | drawGachaPickupInList | 推断: ElementAccessExpression | 变量，在 drawGachaPickupInList 中保存 详情列表 值，供当前逻辑读取或更新。 |
| 30 | cardId | const | drawGachaPickupInList | 推断 | 保存 卡牌ID，用于定位对应业务实体。 |
| 37 | pickUpCardList | const | drawGachaPickupInList | 推断: ObjectLiteralExpression | 保存 pickUp卡牌列表，用于按顺序遍历或批量渲染。 |
| 38 | i | let | drawGachaPickupInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 39 | card | const | drawGachaPickupInList | 推断: NewExpression | 保存当前卡牌领域模型实例。 |
| 40 | rarity | const | drawGachaPickupInList | 推断: CallExpression | 变量，在 drawGachaPickupInList 中保存 rarity 值，供当前逻辑读取或更新。 |
| 41 | weight | const | drawGachaPickupInList | 推断: CallExpression | 变量，在 drawGachaPickupInList 中保存 weight 值，供当前逻辑读取或更新。 |
| 51 | rarity | const | drawGachaPickupInList | 推断 | 变量，在 drawGachaPickupInList 中保存 rarity 值，供当前逻辑读取或更新。 |
| 52 | weight | const | drawGachaPickupInList | 推断 | 变量，在 drawGachaPickupInList 中保存 weight 值，供当前逻辑读取或更新。 |
| 53 | rate | const | drawGachaPickupInList | 推断: BinaryExpression | 变量，在 drawGachaPickupInList 中保存 概率 值，供当前逻辑读取或更新。 |
| 74 | result | const | drawGachaPickupInList | 推断: CallExpression | 保存当前函数最终返回或阶段性处理结果。 |

### render-blocks/list-gacha-rate.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 15 | drawGachaRateInList | function | 模块顶层 | gacha: Gacha; server: Server | Promise<Canvas> | 在图片布局层中绘制卡池概率In列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 19 | rates | const | drawGachaRateInList | 推断: ElementAccessExpression | 变量，在 drawGachaRateInList 中保存 概率列表 值，供当前逻辑读取或更新。 |
| 20 | list | const | drawGachaRateInList | 推断: ArrayLiteralExpression | 变量，在 drawGachaRateInList 中保存 列表 值，供当前逻辑读取或更新。 |
| 21 | times | let | drawGachaRateInList | 推断: FirstLiteralToken | 变量，在 drawGachaRateInList 中保存 时间列表 值，供当前逻辑读取或更新。 |
| 22 | key | let | drawGachaRateInList | 推断: Identifier | 变量，在 drawGachaRateInList 中保存 key 值，供当前逻辑读取或更新。 |
| 33 | i | const | drawGachaRateInList | 推断 | 保存循环下标或对象键。 |

### render-blocks/list-player-card-icon-list.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 16 | drawPlayerCardInList | function | 模块顶层 | player: Player; key: string; cardIdVisible: 推断; lineHeight: 推断 | Promise<Canvas> | 在图片布局层中绘制玩家卡牌In列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 22 | textSize | const | drawPlayerCardInList | 推断: BinaryExpression | 变量，在 drawPlayerCardInList 中保存 文本Size 值，供当前逻辑读取或更新。 |
| 23 | spacing | const | drawPlayerCardInList | 推断: BinaryExpression | 变量，在 drawPlayerCardInList 中保存 spacing 值，供当前逻辑读取或更新。 |
| 24 | promiseList | const | drawPlayerCardInList | Promise<Canvas>[] | 保存 异步任务列表，用于按顺序遍历或批量渲染。 |
| 25 | tempCardDataList | const | drawPlayerCardInList | 推断: PropertyAccessExpression | 保存 临时卡牌数据列表，用于按顺序遍历或批量渲染。 |
| 27 | defaultCardSort | const | drawPlayerCardInList | 推断: ArrayLiteralExpression | 变量，在 drawPlayerCardInList 中保存 default卡牌Sort 值，供当前逻辑读取或更新。 |
| 28 | cardDataList | const | drawPlayerCardInList | 推断: ArrayLiteralExpression | 保存 卡牌数据列表，用于按顺序遍历或批量渲染。 |
| 29 | i | let | drawPlayerCardInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 30 | tempCardData | const | drawPlayerCardInList | 推断: ElementAccessExpression | 变量，在 drawPlayerCardInList 中保存 临时卡牌数据 值，供当前逻辑读取或更新。 |
| 33 | cardIconList | const | drawPlayerCardInList | Array<Canvas> | 保存 卡牌Icon列表，用于按顺序遍历或批量渲染。 |
| 34 | i | const | drawPlayerCardInList | 推断 | 保存循环下标或对象键。 |
| 35 | tempCardData | const | drawPlayerCardInList | 推断: ElementAccessExpression | 变量，在 drawPlayerCardInList 中保存 临时卡牌数据 值，供当前逻辑读取或更新。 |
| 49 | result | const | drawPlayerCardInList | 推断: AwaitExpression | 保存当前函数最终返回或阶段性处理结果。 |
| 50 | r | const | drawPlayerCardInList | 推断 | 变量，在 drawPlayerCardInList 中保存 r 值，供当前逻辑读取或更新。 |

### render-blocks/list-player-ranking.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 32 | drawPlayerRankingInList | function | 模块顶层 | user: User; backgroudColor: string; server: Server | Promise<Canvas> | 在图片布局层中绘制玩家RankingIn列表。 |
| 48 | removeBraces | function | drawPlayerRankingInList | text: string | string | 在图片布局层中移除Braces。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 13 | uid | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 uid 值，供当前逻辑读取或更新。 |
| 14 | name | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 名称 值，供当前逻辑读取或更新。 |
| 15 | introduction | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 introduction 值，供当前逻辑读取或更新。 |
| 16 | rank | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 rank 值，供当前逻辑读取或更新。 |
| 17 | sid | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 sid 值，供当前逻辑读取或更新。 |
| 18 | strained | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 strained 值，供当前逻辑读取或更新。 |
| 19 | degrees | type-field | 模块顶层 | number[] | 字段，在 模块顶层 中保存 称号列表 值，供当前逻辑读取或更新。 |
| 20 | ranking | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 ranking 值，供当前逻辑读取或更新。 |
| 21 | currentPt | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 当前项Pt 值，供当前逻辑读取或更新。 |
| 37 | canvas | const | drawPlayerRankingInList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 38 | ctx | const | drawPlayerRankingInList | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 49 | newText | const | removeBraces | 推断: CallExpression | 变量，在 removeBraces 中保存 new文本 值，供当前逻辑读取或更新。 |
| 54 | rankingImage | let | drawPlayerRankingInList | 推断 | 保存 ranking图片，用于图片绘制或输出。 |
| 58 | rankIamgeBuffer | const | drawPlayerRankingInList | 推断: AwaitExpression | 保存 rankIamge缓冲区，用于二进制资源处理。 |
| 73 | headShotImage | const | drawPlayerRankingInList | 推断: AwaitExpression | 保存 headShot图片，用于图片绘制或输出。 |
| 83 | playerNameImage | const | drawPlayerRankingInList | 推断: CallExpression | 保存 玩家名称图片，用于图片绘制或输出。 |
| 91 | i | let | drawPlayerRankingInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 92 | degreeImage | const | drawPlayerRankingInList | 推断: AwaitExpression | 保存 称号图片，用于图片绘制或输出。 |
| 103 | playerIntroductionImage | const | drawPlayerRankingInList | 推断: CallExpression | 保存 玩家Introduction图片，用于图片绘制或输出。 |
| 111 | playerRankImage | const | drawPlayerRankingInList | 推断: CallExpression | 保存 玩家Rank图片，用于图片绘制或输出。 |
| 119 | idImage | const | drawPlayerRankingInList | 推断: CallExpression | 保存 ID图片，用于图片绘制或输出。 |
| 127 | ptImage | const | drawPlayerRankingInList | 推断: CallExpression | 保存 pt图片，用于图片绘制或输出。 |

### render-blocks/list-rarity.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 18 | loadImageOnce | function | 模块顶层 | - | 推断 | 在图片布局层中加载图片Once。 |
| 34 | drawRarityInList | function | 模块顶层 | options1: RarityInListOptions | Promise<Canvas> | 在图片布局层中绘制RarityIn列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 8 | key | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 key 值，供当前逻辑读取或更新。 |
| 9 | rarity | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 rarity 值，供当前逻辑读取或更新。 |
| 10 | trainingStatus | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 training状态 值，供当前逻辑读取或更新。 |
| 11 | text | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 文本 值，供当前逻辑读取或更新。 |
| 14 | starList | const | 模块顶层 | { [type: string]: Image } | 保存 star列表，用于按顺序遍历或批量渲染。 |
| 40 | content | const | drawRarityInList | Array<string \| Image \| Canvas> | 变量，在 drawRarityInList 中保存 content 值，供当前逻辑读取或更新。 |
| 41 | star | let | drawRarityInList | Image | 变量，在 drawRarityInList 中保存 star 值，供当前逻辑读取或更新。 |
| 47 | i | let | drawRarityInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 53 | canvas | const | drawRarityInList | 推断: CallExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |

### render-blocks/list-skill.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 24 | drawSkillInList | function | 模块顶层 | options1: SkillInListOptions; displayedServerList: Server[] | Promise<Canvas> | 在图片布局层中绘制技能In列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 13 | key | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 key 值，供当前逻辑读取或更新。 |
| 14 | card | type-field | 模块顶层 | Card | 保存当前卡牌领域模型实例。 |
| 15 | content | type-field | 模块顶层 | Skill | 字段，在 模块顶层 中保存 content 值，供当前逻辑读取或更新。 |
| 28 | listImage | const | drawSkillInList | 推断: AwaitExpression | 保存 列表图片，用于图片绘制或输出。 |
| 33 | server | const | drawSkillInList | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 34 | tipsImage | const | drawSkillInList | 推断: CallExpression | 保存 tips图片，用于图片绘制或输出。 |

### render-blocks/list-song.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 24 | drawSongInList | function | 模块顶层 | song: Song; difficulty: number; text: string; displayedServerList: Server[] | Promise<Canvas> | 在图片布局层中绘制歌曲In列表。 |
| 87 | drawSongListInList | function | 模块顶层 | songs: Song[]; difficulty: number; text: string; displayedServerList: Server[] | Promise<Canvas> | 在图片布局层中绘制歌曲列表In列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 30 | server | const | drawSongInList | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 31 | songImage | const | drawSongInList | 推断: CallExpression | 保存 歌曲图片，用于图片绘制或输出。 |
| 37 | canvas | const | drawSongInList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 38 | ctx | const | drawSongInList | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 41 | idImage | const | drawSongInList | 推断: CallExpression | 保存 ID图片，用于图片绘制或输出。 |
| 49 | fullText | let | drawSongInList | 推断: TemplateExpression | 变量，在 drawSongInList 中保存 full文本 值，供当前逻辑读取或更新。 |
| 57 | textImage | const | drawSongInList | 推断: CallExpression | 保存 文本图片，用于图片绘制或输出。 |
| 66 | difficultyImage | const | drawSongInList | 推断: ConditionalExpression | 保存 难度图片，用于图片绘制或输出。 |
| 93 | height | const | drawSongListInList | number | 保存当前绘制高度。 |
| 94 | canvas | const | drawSongListInList | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 95 | ctx | const | drawSongListInList | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 96 | x | const | drawSongListInList | 推断: FirstLiteralToken | 保存当前横向绘制坐标。 |
| 97 | y | let | drawSongListInList | 推断: FirstLiteralToken | 保存当前纵向绘制坐标。 |
| 98 | views | const | drawSongListInList | Canvas[] | 变量，在 drawSongListInList 中保存 views 值，供当前逻辑读取或更新。 |
| 99 | line | const | drawSongListInList | 推断: CallExpression | 变量，在 drawSongListInList 中保存 line 值，供当前逻辑读取或更新。 |
| 110 | i | let | drawSongListInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 125 | i | let | drawSongListInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |

### render-blocks/list-stat.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | drawCardStatInList | function | 模块顶层 | card: Card | 推断 | 在图片布局层中绘制卡牌数值In列表。 |
| 47 | drawStatInList | function | 模块顶层 | stat: Stat | 推断 | 在图片布局层中绘制数值In列表。 |
| 70 | drawCardStatDivided | function | 模块顶层 | stat: Stat; statTotal: number; limitBreakstat: Stat | Promise<Canvas> | 在图片布局层中绘制卡牌数值Divided。 |
| 85 | drawStatLine | function | drawCardStatDivided | key: string; value: number; total: number | Canvas | 在图片布局层中绘制数值线条。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 13 | statConfig | const | 模块顶层 | Record<string, { color: string; name: string }> | 变量，在 模块顶层 中保存 数值配置 值，供当前逻辑读取或更新。 |
| 13 | color | type-field | statConfig | string | 字段，在 statConfig 中保存 颜色 值，供当前逻辑读取或更新。 |
| 13 | name | type-field | statConfig | string | 字段，在 statConfig 中保存 名称 值，供当前逻辑读取或更新。 |
| 22 | stat | const | drawCardStatInList | 推断: AwaitExpression | 变量，在 drawCardStatInList 中保存 数值 值，供当前逻辑读取或更新。 |
| 23 | limitBreakstat | const | drawCardStatInList | 推断: CallExpression | 变量，在 drawCardStatInList 中保存 limitBreakstat 值，供当前逻辑读取或更新。 |
| 24 | limitBreakstatTotal | const | drawCardStatInList | 推断: BinaryExpression | 变量，在 drawCardStatInList 中保存 limitBreakstatTotal 值，供当前逻辑读取或更新。 |
| 28 | statTotal | const | drawCardStatInList | 推断: BinaryExpression | 变量，在 drawCardStatInList 中保存 数值Total 值，供当前逻辑读取或更新。 |
| 29 | statImage | const | drawCardStatInList | 推断: AwaitExpression | 保存 数值图片，用于图片绘制或输出。 |
| 30 | list | const | drawCardStatInList | 推断: ArrayLiteralExpression | 变量，在 drawCardStatInList 中保存 列表 值，供当前逻辑读取或更新。 |
| 48 | statTotal | const | drawStatInList | 推断: CallExpression | 变量，在 drawStatInList 中保存 数值Total 值，供当前逻辑读取或更新。 |
| 49 | statImage | const | drawStatInList | 推断: AwaitExpression | 保存 数值图片，用于图片绘制或输出。 |
| 50 | list | const | drawStatInList | 推断: ArrayLiteralExpression | 变量，在 drawStatInList 中保存 列表 值，供当前逻辑读取或更新。 |
| 75 | widthMax | const | drawCardStatDivided | 推断: FirstLiteralToken | 变量，在 drawCardStatDivided 中保存 宽度最大值 值，供当前逻辑读取或更新。 |
| 86 | canvas | const | drawStatLine | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 87 | ctx | const | drawStatLine | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 88 | text | let | drawStatLine | 推断: TemplateExpression | 变量，在 drawStatLine 中保存 文本 值，供当前逻辑读取或更新。 |
| 92 | textImage | const | drawStatLine | 推断: CallExpression | 保存 文本图片，用于图片绘制或输出。 |
| 98 | roundedRect | const | drawStatLine | 推断: CallExpression | 变量，在 drawStatLine 中保存 roundedRect 值，供当前逻辑读取或更新。 |
| 109 | list | const | drawCardStatDivided | 推断: ArrayLiteralExpression | 变量，在 drawCardStatDivided 中保存 列表 值，供当前逻辑读取或更新。 |
| 110 | key | const | drawCardStatDivided | 推断 | 变量，在 drawCardStatDivided 中保存 key 值，供当前逻辑读取或更新。 |
| 112 | element | const | drawCardStatDivided | 推断: ElementAccessExpression | 变量，在 drawCardStatDivided 中保存 element 值，供当前逻辑读取或更新。 |

### render-blocks/list-time.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 30 | drawTimeInList | function | 模块顶层 | options1: TimeInListOptions; displayedServerList: Server[] | Promise<Canvas> | 在图片布局层中绘制时间In列表。 |
| 69 | getProbableTimeDifference | function | 模块顶层 | eventId: number; currentEvent: Event | number | 在图片布局层中获取Probable时间Difference。 |
| 163 | formatTime | function | 模块顶层 | timeStamp: number \| null | 推断 | 在图片布局层中格式化时间。 |
| 196 | formatMonthDay | function | 模块顶层 | timeStamp: number \| null | 推断 | 在图片布局层中格式化MonthDay。 |
| 203 | toJapanTime | function | formatMonthDay | dateString: 推断 | 推断 | 在图片布局层中转换为Japan时间。 |
| 238 | formatTimePeriod | function | 模块顶层 | period: number | string | 在图片布局层中格式化时间Period。 |
| 285 | formatSeconds | function | 模块顶层 | value: number | 推断 | 在图片布局层中格式化Seconds。 |
| 314 | occupiedDays | function | 模块顶层 | startTs: number; endTs: number | number | 在图片布局层中处理occupiedDays。 |
| 338 | normalizeTimestamp | function | 模块顶层 | time: number \| string | number | 在图片布局层中规范化Timestamp。 |
| 349 | getServerUtcOffset | function | 模块顶层 | server: Server | number | 在图片布局层中获取服务器UtcOffset。 |
| 372 | getDateByServerTimezone | function | 模块顶层 | time: number \| string; server: Server | Date | 在图片布局层中获取DateBy服务器Timezone。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 18 | key | type-field | 模块顶层 | string | 字段，在 模块顶层 中保存 key 值，供当前逻辑读取或更新。 |
| 19 | content | type-field | 模块顶层 | Array<number \| null> | 字段，在 模块顶层 中保存 content 值，供当前逻辑读取或更新。 |
| 20 | eventId | type-field | 模块顶层 | number | 保存 活动ID，用于定位对应业务实体。 |
| 21 | estimateCNTime | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 estimateCN时间 值，供当前逻辑读取或更新。 |
| 34 | formattedTimeList | const | drawTimeInList | Array<string> | 保存 formatted时间列表，用于按顺序遍历或批量渲染。 |
| 35 | i | let | drawTimeInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 36 | element | const | drawTimeInList | 推断: ElementAccessExpression | 变量，在 drawTimeInList 中保存 element 值，供当前逻辑读取或更新。 |
| 39 | currentEvent | const | drawTimeInList | 推断: CallExpression | 变量，在 drawTimeInList 中保存 当前项活动 值，供当前逻辑读取或更新。 |
| 40 | currentEventId | const | drawTimeInList | 推断: PropertyAccessExpression | 保存 当前项活动ID，用于定位对应业务实体。 |
| 53 | canvas | const | drawTimeInList | 推断: AwaitExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 73 | eventsData | const | getProbableTimeDifference | 推断: ElementAccessExpression | 变量，在 getProbableTimeDifference 中保存 活动列表数据 值，供当前逻辑读取或更新。 |
| 74 | presentEventJP | const | getProbableTimeDifference | 推断: PropertyAccessExpression | 变量，在 getProbableTimeDifference 中保存 present活动JP 值，供当前逻辑读取或更新。 |
| 75 | currentEventWithNoBanGDaysTotalOffset | let | getProbableTimeDifference | 推断: FirstLiteralToken | 变量，在 getProbableTimeDifference 中保存 当前项活动WithNoBanGDaysTotalOffset 值，供当前逻辑读取或更新。 |
| 76 | currentEventId | const | getProbableTimeDifference | 推断: PropertyAccessExpression | 保存 当前项活动ID，用于定位对应业务实体。 |
| 78 | eventLenOffset | const | getProbableTimeDifference | 推断: BinaryExpression | 变量，在 getProbableTimeDifference 中保存 活动LenOffset 值，供当前逻辑读取或更新。 |
| 123 | probableTimeOffset | let | getProbableTimeDifference | 推断: ElementAccessExpression | 变量，在 getProbableTimeDifference 中保存 probable时间Offset 值，供当前逻辑读取或更新。 |
| 124 | i | let | getProbableTimeDifference | 推断: Identifier | 保存循环下标或对象键。 |
| 142 | presentEventJPLen | const | getProbableTimeDifference | 推断: BinaryExpression | 变量，在 getProbableTimeDifference 中保存 present活动JPLen 值，供当前逻辑读取或更新。 |
| 168 | date | const | formatTime | 推断: NewExpression | 变量，在 formatTime 中保存 date 值，供当前逻辑读取或更新。 |
| 169 | nMinutes | let | formatTime | string | 变量，在 formatTime 中保存 nMinutes 值，供当前逻辑读取或更新。 |
| 178 | temp | const | formatTime | 推断: BinaryExpression | 变量，在 formatTime 中保存 临时 值，供当前逻辑读取或更新。 |
| 205 | date | const | toJapanTime | 推断: NewExpression | 变量，在 toJapanTime 中保存 date 值，供当前逻辑读取或更新。 |
| 208 | offset | const | toJapanTime | 推断: BinaryExpression | 变量，在 toJapanTime 中保存 offset 值，供当前逻辑读取或更新。 |
| 211 | utcTime | const | toJapanTime | 推断: BinaryExpression | 变量，在 toJapanTime 中保存 utc时间 值，供当前逻辑读取或更新。 |
| 214 | japanTimeOffset | const | toJapanTime | 推断: BinaryExpression | 变量，在 toJapanTime 中保存 japan时间Offset 值，供当前逻辑读取或更新。 |
| 217 | japanTime | const | toJapanTime | 推断: NewExpression | 变量，在 toJapanTime 中保存 japan时间 值，供当前逻辑读取或更新。 |
| 226 | date | const | formatMonthDay | 推断: CallExpression | 变量，在 formatMonthDay 中保存 date 值，供当前逻辑读取或更新。 |
| 227 | temp | const | formatMonthDay | 推断: BinaryExpression | 变量，在 formatMonthDay 中保存 临时 值，供当前逻辑读取或更新。 |
| 244 | century | const | formatTimePeriod | 推断: CallExpression | 变量，在 formatTimePeriod 中保存 century 值，供当前逻辑读取或更新。 |
| 245 | years | const | formatTimePeriod | 推断: CallExpression | 变量，在 formatTimePeriod 中保存 years 值，供当前逻辑读取或更新。 |
| 246 | months | const | formatTimePeriod | 推断: CallExpression | 变量，在 formatTimePeriod 中保存 months 值，供当前逻辑读取或更新。 |
| 247 | days | const | formatTimePeriod | 推断: CallExpression | 变量，在 formatTimePeriod 中保存 days 值，供当前逻辑读取或更新。 |
| 250 | hours | const | formatTimePeriod | 推断: CallExpression | 变量，在 formatTimePeriod 中保存 hours 值，供当前逻辑读取或更新。 |
| 251 | minutes | const | formatTimePeriod | 推断: CallExpression | 变量，在 formatTimePeriod 中保存 minutes 值，供当前逻辑读取或更新。 |
| 252 | seconds | const | formatTimePeriod | 推断: CallExpression | 变量，在 formatTimePeriod 中保存 seconds 值，供当前逻辑读取或更新。 |
| 254 | temp | let | formatTimePeriod | 推断: StringLiteral | 变量，在 formatTimePeriod 中保存 临时 值，供当前逻辑读取或更新。 |
| 286 | theTime | let | formatSeconds | 推断: Identifier | 变量，在 formatSeconds 中保存 the时间 值，供当前逻辑读取或更新。 |
| 287 | theTime1 | let | formatSeconds | 推断: FirstLiteralToken | 变量，在 formatSeconds 中保存 theTime1 值，供当前逻辑读取或更新。 |
| 288 | theTime2 | let | formatSeconds | 推断: FirstLiteralToken | 变量，在 formatSeconds 中保存 theTime2 值，供当前逻辑读取或更新。 |
| 297 | result | let | formatSeconds | 推断: BinaryExpression | 保存当前函数最终返回或阶段性处理结果。 |
| 315 | start | const | occupiedDays | 推断: NewExpression | 变量，在 occupiedDays 中保存 start 值，供当前逻辑读取或更新。 |
| 316 | end | const | occupiedDays | 推断: NewExpression | 变量，在 occupiedDays 中保存 end 值，供当前逻辑读取或更新。 |
| 319 | startDay | const | occupiedDays | 推断: NewExpression | 变量，在 occupiedDays 中保存 startDay 值，供当前逻辑读取或更新。 |
| 324 | endDay | const | occupiedDays | 推断: NewExpression | 变量，在 occupiedDays 中保存 endDay 值，供当前逻辑读取或更新。 |
| 326 | msPerDay | const | occupiedDays | 推断: BinaryExpression | 变量，在 occupiedDays 中保存 msPerDay 值，供当前逻辑读取或更新。 |
| 339 | t | const | normalizeTimestamp | 推断: CallExpression | 变量，在 normalizeTimestamp 中保存 t 值，供当前逻辑读取或更新。 |
| 376 | timestamp | const | getDateByServerTimezone | 推断: CallExpression | 变量，在 getDateByServerTimezone 中保存 timestamp 值，供当前逻辑读取或更新。 |
| 377 | offset | const | getDateByServerTimezone | 推断: CallExpression | 变量，在 getDateByServerTimezone 中保存 offset 值，供当前逻辑读取或更新。 |

### render-blocks/skill-text.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 12 | loadImageOnce | function | 模块顶层 | - | 推断 | 在图片布局层中加载图片Once。 |
| 32 | drawCardIconSkill | function | 模块顶层 | skill: Skill | Promise<Canvas> | 在图片布局层中绘制卡牌图标技能。 |
| 58 | <anonymous> | callback | drawCardIconSkill | EffectType: 推断 | 推断 | 作为 \`EffectTypes.forEach\` 的回调，处理 EffectType。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 8 | skillIcon | const | 模块顶层 | { [skillType: string]: Image } | 变量，在 模块顶层 中保存 技能Icon 值，供当前逻辑读取或更新。 |
| 33 | content | const | drawCardIconSkill | Array<Image \| string> | 变量，在 drawCardIconSkill 中保存 content 值，供当前逻辑读取或更新。 |
| 34 | EffectTypes | const | drawCardIconSkill | 推断: CallExpression | 变量，在 drawCardIconSkill 中保存 Effect类型列表 值，供当前逻辑读取或更新。 |
| 35 | ScoreUpMaxValue | const | drawCardIconSkill | 推断: CallExpression | 变量，在 drawCardIconSkill 中保存 分数Up最大值值 值，供当前逻辑读取或更新。 |
| 38 | skillValue | let | drawCardIconSkill | 推断: CallExpression | 变量，在 drawCardIconSkill 中保存 技能值 值，供当前逻辑读取或更新。 |
| 67 | stringWithImage | const | drawCardIconSkill | 推断: CallExpression | 保存 stringWith图片，用于图片绘制或输出。 |
| 76 | textbase | const | drawCardIconSkill | 推断: AwaitExpression | 变量，在 drawCardIconSkill 中保存 textbase 值，供当前逻辑读取或更新。 |
| 79 | canvas | const | drawCardIconSkill | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 80 | ctx | const | drawCardIconSkill | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |

### render-blocks/timeline-chart.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 33 | drawTimeLineChart | function | 模块顶层 | options1: drawTimeLineChartOptions; displayLabel: 推断 | 推断 | 在图片布局层中绘制时间线条谱面。 |
| 46 | <anonymous> | callback | yMax | dataset: any | 推断 | 作为 \`data.datasets.map\` 的回调，处理 dataset。 |
| 47 | <anonymous> | callback | yMax | pt: any | 推断 | 作为 \`dataset.data.map\` 的回调，处理 pt。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 18 | start | type-field | 模块顶层 | Date | 字段，在 模块顶层 中保存 start 值，供当前逻辑读取或更新。 |
| 19 | end | type-field | 模块顶层 | Date | 字段，在 模块顶层 中保存 end 值，供当前逻辑读取或更新。 |
| 20 | setStartToZero | type-field | 模块顶层 | boolean | 字段，在 模块顶层 中保存 集合StartToZero 值，供当前逻辑读取或更新。 |
| 21 | data | type-field | 模块顶层 | { datasets: any[]; } | 保存当前接口、主数据或模型计算得到的业务数据。 |
| 22 | datasets | type-field | 模块顶层 | any[] | 字段，在 模块顶层 中保存 datasets 值，供当前逻辑读取或更新。 |
| 37 | width | const | drawTimeLineChart | 推断: FirstLiteralToken | 保存当前绘制宽度。 |
| 38 | height | const | drawTimeLineChart | 推断: FirstLiteralToken | 保存当前绘制高度。 |
| 41 | canvas | const | drawTimeLineChart | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 42 | ctx | const | drawTimeLineChart | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 45 | yMax | const | drawTimeLineChart | 推断: CallExpression | 变量，在 drawTimeLineChart 中保存 纵坐标最大值 值，供当前逻辑读取或更新。 |
| 52 | options | const | drawTimeLineChart | 推断: ObjectLiteralExpression | 保存当前调用的配置项。 |
| 81 | config | const | drawTimeLineChart | 推断: ObjectLiteralExpression | 保存当前模块或函数使用的运行配置。 |

### render-blocks/title.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | loadImageOnce | function | 模块顶层 | - | 推断 | 在图片布局层中加载图片Once。 |
| 23 | drawTitle | function | 模块顶层 | title1: string; title2: string | Canvas | 在图片布局层中绘制标题。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 7 | titleImage | let | 模块顶层 | Image | 保存 标题图片，用于图片绘制或输出。 |
| 24 | canvas | const | drawTitle | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 25 | ctx | const | drawTitle | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 27 | text1 | const | drawTitle | 推断: CallExpression | 变量，在 drawTitle 中保存 text1 值，供当前逻辑读取或更新。 |
| 35 | text2 | const | drawTitle | 推断: CallExpression | 变量，在 drawTitle 中保存 text2 值，供当前逻辑读取或更新。 |

### render-blocks/image-stack.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | stackImage | function | 模块顶层 | list: Array<Image \| Canvas> | 推断 | 在图片布局层中处理stack图片。 |
| 32 | stackImageHorizontal | function | 模块顶层 | list: Array<Image \| Canvas> | 推断 | 在图片布局层中处理stack图片Horizontal。 |
| 62 | resizeImage | function | 模块顶层 | options1: ResizeImageOptions | 推断 | 在图片布局层中调整图片。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 9 | maxW | let | stackImage | 推断: FirstLiteralToken | 变量，在 stackImage 中保存 最大值W 值，供当前逻辑读取或更新。 |
| 10 | allH | let | stackImage | 推断: FirstLiteralToken | 变量，在 stackImage 中保存 allH 值，供当前逻辑读取或更新。 |
| 11 | i | let | stackImage | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 17 | tempCanvas | const | stackImage | 推断: NewExpression | 保存 临时画布，用于图片绘制或输出。 |
| 18 | ctx | const | stackImage | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 19 | allH2 | let | stackImage | 推断: FirstLiteralToken | 变量，在 stackImage 中保存 allH2 值，供当前逻辑读取或更新。 |
| 20 | i | let | stackImage | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 33 | maxH | let | stackImageHorizontal | 推断: FirstLiteralToken | 变量，在 stackImageHorizontal 中保存 最大值H 值，供当前逻辑读取或更新。 |
| 34 | allW | let | stackImageHorizontal | 推断: FirstLiteralToken | 变量，在 stackImageHorizontal 中保存 allW 值，供当前逻辑读取或更新。 |
| 35 | i | let | stackImageHorizontal | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 41 | tempCanvas | const | stackImageHorizontal | 推断: NewExpression | 保存 临时画布，用于图片绘制或输出。 |
| 42 | ctx | const | stackImageHorizontal | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 43 | allW2 | let | stackImageHorizontal | 推断: FirstLiteralToken | 变量，在 stackImageHorizontal 中保存 allW2 值，供当前逻辑读取或更新。 |
| 44 | i | let | stackImageHorizontal | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 52 | image | type-field | 模块顶层 | Image \| Canvas | 保存当前加载或绘制的图片对象。 |
| 53 | heightMax | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 高度最大值 值，供当前逻辑读取或更新。 |
| 54 | widthMax | type-field | 模块顶层 | number | 字段，在 模块顶层 中保存 宽度最大值 值，供当前逻辑读取或更新。 |
| 67 | height | let | resizeImage | 推断: PropertyAccessExpression | 保存当前绘制高度。 |
| 68 | width | let | resizeImage | 推断: PropertyAccessExpression | 保存当前绘制宽度。 |
| 77 | canvas | const | resizeImage | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 78 | ctx | const | resizeImage | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |

### runtime/config.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 55 | reportDataSourceProblem | function | 模块顶层 | - | 推断 | 在运行时配置层中记录数据来源Problem。 |
| 70 | clearDataSourceProblem | function | 模块顶层 | - | 推断 | 在运行时配置层中清理数据来源Problem。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 12 | projectRoot | const | 模块顶层 | string | 变量，在 模块顶层 中保存 project根目录 值，供当前逻辑读取或更新。 |
| 13 | assetsRootPath | const | 模块顶层 | string | 保存 资源列表根目录路径，用于定位本地文件或资源目录。 |
| 14 | configPath | const | 模块顶层 | string | 保存 配置路径，用于定位本地文件或资源目录。 |
| 15 | fuzzySearchPath | const | 模块顶层 | 推断: CallExpression | 保存 模糊搜索搜索路径，用于定位本地文件或资源目录。 |
| 19 | cacheRootPath | const | 模块顶层 | string | 保存 缓存根目录路径，用于定位本地文件或资源目录。 |
| 23 | bestdoriApiPath | const | 模块顶层 | 推断: ObjectLiteralExpression | 保存 BestdoriAPI路径，用于定位本地文件或资源目录。 |
| 44 | bestdoriUrl | const | 模块顶层 | string | 保存 BestdoriURL，用于请求接口或下载资源。 |
| 46 | hhwxUrl | const | 模块顶层 | string | 保存 hhwxURL，用于请求接口或下载资源。 |
| 47 | preferHhwxSource | let | 模块顶层 | 推断: FalseKeyword | 变量，在 模块顶层 中保存 preferHhwx来源 值，供当前逻辑读取或更新。 |
| 49 | enableAutoTrackerDataSourceSwitch | const | 模块顶层 | 推断: TrueKeyword | 变量，在 模块顶层 中保存 enableAutoTracker数据来源Switch 值，供当前逻辑读取或更新。 |
| 50 | trackerAutoSwitchThreshold | const | 模块顶层 | number | 变量，在 模块顶层 中保存 trackerAutoSwitchThreshold 值，供当前逻辑读取或更新。 |
| 51 | trackerAutoSwitchFlags | let | 模块顶层 | number | 变量，在 模块顶层 中保存 trackerAutoSwitchFlags 值，供当前逻辑读取或更新。 |
| 74 | globalDefaultServer | const | 模块顶层 | Array<Server> | 变量，在 模块顶层 中保存 globalDefault服务器 值，供当前逻辑读取或更新。 |
| 77 | globalServerPriority | const | 模块顶层 | Array<Server> | 变量，在 模块顶层 中保存 global服务器Priority 值，供当前逻辑读取或更新。 |
| 81 | serverNameFullList | const | 模块顶层 | 推断: ArrayLiteralExpression | 保存 服务器名称Full列表，用于按顺序遍历或批量渲染。 |
| 83 | tierListOfServer | const | 模块顶层 | Record<string, readonly number[]> | 变量，在 模块顶层 中保存 tier列表Of服务器 值，供当前逻辑读取或更新。 |
| 86 | statusName | const | 模块顶层 | Record<string, string> | 变量，在 模块顶层 中保存 状态名称 值，供当前逻辑读取或更新。 |

### runtime/logger.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 11 | logger | function | 模块顶层 | type: string; message: unknown | 推断 | 在运行时配置层中处理logger。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 3 | tsuguLogger | const | 模块顶层 | 推断: NewExpression | 变量，在 模块顶层 中保存 tsugu日志函数 值，供当前逻辑读取或更新。 |

### command-renderers/card-detail.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 36 | pushSection | function | 模块顶层 | list: Array<Image \| Canvas>; section: Image \| Canvas | 推断 | 在QQBot 图片视图层中推入区块。 |
| 48 | hasOwn | function | 模块顶层 | source: object; key: string | boolean | 在QQBot 图片视图层中判断对象是否包含指定自有属性。 |
| 58 | appendCardIllustrations | function | 模块顶层 | list: Array<Image \| Canvas>; card: Card | Promise<void> | 在QQBot 图片视图层中追加卡牌Illustrations。 |
| 82 | shouldShowGachaText | function | 模块顶层 | card: Card; source: 推断; displayedServerList: Server[] | boolean | 在QQBot 图片视图层中判断是否需要Show卡池文本。 |
| 109 | appendCardBaseSections | function | 模块顶层 | list: Array<Image \| Canvas>; card: Card; source: 推断; displayedServerList: Server[] | Promise<void> | 在QQBot 图片视图层中追加卡牌基础区块列表。 |
| 183 | sortGachaIdsForServer | function | 模块顶层 | gachaIdList: number[]; server: Server | number[] | 在QQBot 图片视图层中排序卡池ID 列表For服务器。 |
| 187 | <anonymous> | callback | sortGachaIdsForServer | a: 推断; b: 推断 | 推断 | 作为 \`[...gachaIdList].sort\` 的回调，处理 a、b。 |
| 209 | appendRelatedEventImage | function | 模块顶层 | eventImageList: Array<Canvas \| Image>; eventIdSet: Set<number>; eventId: number; displayedServerList: Server[]; title: string | Promise<void> | 在QQBot 图片视图层中追加Related活动图片。 |
| 238 | collectCardSourceSections | function | 模块顶层 | card: Card; displayedServerList: Server[] | Promise<CardSourceSections> | 在QQBot 图片视图层中收集卡牌来源区块列表。 |
| 297 | drawCardDetail | function | 模块顶层 | cardId: number; displayedServerList: Server[]; useEasyBG: boolean; compress: boolean | Promise<Array<string \| Buffer>> | 在QQBot 图片视图层中绘制卡牌详情。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 62 | trainingStatus | const | appendCardIllustrations | 推断 | 变量，在 appendCardIllustrations 中保存 training状态 值，供当前逻辑读取或更新。 |
| 90 | server | const | shouldShowGachaText | 推断 | 保存当前目标服务器枚举或服务器代码。 |
| 128 | skill | const | appendCardBaseSections | 推断: NewExpression | 变量，在 appendCardBaseSections 中保存 技能 值，供当前逻辑读取或更新。 |
| 188 | gachaA | const | sortGachaIdsForServer | 推断: NewExpression | 变量，在 sortGachaIdsForServer 中保存 卡池A 值，供当前逻辑读取或更新。 |
| 189 | gachaB | const | sortGachaIdsForServer | 推断: NewExpression | 变量，在 sortGachaIdsForServer 中保存 卡池B 值，供当前逻辑读取或更新。 |
| 216 | event | const | appendRelatedEventImage | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 227 | eventImageList | type-field | 模块顶层 | Array<Canvas \| Image> | 保存 活动图片列表，用于按顺序遍历或批量渲染。 |
| 228 | gachaImageList | type-field | 模块顶层 | Array<Canvas \| Image> | 保存 卡池图片列表，用于按顺序遍历或批量渲染。 |
| 242 | eventIdSet | const | collectCardSourceSections | 推断: NewExpression | 保存 活动ID集合 集合，用于去重或成员判断。 |
| 243 | gachaIdSet | const | collectCardSourceSections | 推断: NewExpression | 保存 卡池ID集合 集合，用于去重或成员判断。 |
| 244 | eventImageList | const | collectCardSourceSections | Array<Canvas \| Image> | 保存 活动图片列表，用于按顺序遍历或批量渲染。 |
| 245 | gachaImageList | const | collectCardSourceSections | Array<Canvas \| Image> | 保存 卡池图片列表，用于按顺序遍历或批量渲染。 |
| 247 | server | const | collectCardSourceSections | 推断 | 保存当前目标服务器枚举或服务器代码。 |
| 248 | titlePrefix | const | collectCardSourceSections | 推断: ElementAccessExpression | 变量，在 collectCardSourceSections 中保存 标题Prefix 值，供当前逻辑读取或更新。 |
| 249 | releaseEventList | const | collectCardSourceSections | 推断: ElementAccessExpression | 保存 发布活动列表，用于按顺序遍历或批量渲染。 |
| 260 | releaseGachaList | const | collectCardSourceSections | 推断: ElementAccessExpression | 保存 发布卡池列表，用于按顺序遍历或批量渲染。 |
| 265 | gacha | const | collectCardSourceSections | 推断: NewExpression | 保存当前卡池领域模型实例。 |
| 266 | eventId | const | collectCardSourceSections | 推断: ElementAccessExpression | 保存 活动ID，用于定位对应业务实体。 |
| 303 | card | const | drawCardDetail | 推断: NewExpression | 保存当前卡牌领域模型实例。 |
| 308 | source | const | drawCardDetail | 推断: PropertyAccessExpression | 变量，在 drawCardDetail 中保存 来源 值，供当前逻辑读取或更新。 |
| 310 | list | const | drawCardDetail | Array<Image \| Canvas> | 变量，在 drawCardDetail 中保存 列表 值，供当前逻辑读取或更新。 |
| 344 | listImage | const | drawCardDetail | 推断: CallExpression | 保存 列表图片，用于图片绘制或输出。 |
| 345 | all | const | drawCardDetail | 推断: ArrayLiteralExpression | 变量，在 drawCardDetail 中保存 all 值，供当前逻辑读取或更新。 |
| 349 | eventImageList | const | drawCardDetail | 推断: AwaitExpression | 保存 活动图片列表，用于按顺序遍历或批量渲染。 |
| 349 | gachaImageList | const | drawCardDetail | 推断: AwaitExpression | 保存 卡池图片列表，用于按顺序遍历或批量渲染。 |
| 355 | BGimage | const | drawCardDetail | 推断: ConditionalExpression | 变量，在 drawCardDetail 中保存 BGimage 值，供当前逻辑读取或更新。 |

### command-renderers/card-list.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 29 | drawCardList | function | 模块顶层 | matches: FuzzySearchResult; displayedServerList: Server[]; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制卡牌列表。 |
| 72 | createEntity | arrow-function | matchCardList | cardId: 推断 | 推断 | 在QQBot 图片视图层中创建Entity。 |
| 78 | isCandidate | arrow-function | matchCardList | card: 推断 | 推断 | 在QQBot 图片视图层中判断Candidate。 |
| 85 | isReleased | arrow-function | matchCardList | card: 推断; displayedServerList: 推断 | 推断 | 在QQBot 图片视图层中判断Released。 |
| 86 | <anonymous> | callback | matchCardList | server: 推断 | 推断 | 作为 \`displayedServerList.some\` 的回调，处理 server。 |
| 93 | isMatched | arrow-function | matchCardList | matches: 推断; card: 推断 | 推断 | 在QQBot 图片视图层中判断Matched。 |
| 99 | relationValue | arrow-function | matchCardList | card: 推断 | 推断 | 在QQBot 图片视图层中处理关系表达式值。 |
| 108 | getCardListAxes | function | 模块顶层 | cardList: Card[] | { characterIdList: number[]; attributeList: CardAttribute[]; } | 在QQBot 图片视图层中获取卡牌列表Axes。 |
| 119 | <anonymous> | callback | getCardListAxes | a: 推断; b: 推断 | 推断 | 作为 \`[...characterIdSet].sort\` 的回调，处理 a、b。 |
| 130 | drawCharacterIcon | function | 模块顶层 | characterId: number \| null | Promise<Canvas> | 在QQBot 图片视图层中绘制角色图标。 |
| 150 | drawWideCardList | function | 模块顶层 | cardList: Card[]; characterIdList: number[]; attributeList: CardAttribute[] | Promise<Canvas \| Array<Buffer \| string>> | 在QQBot 图片视图层中绘制Wide卡牌列表。 |
| 199 | drawCompactCardList | function | 模块顶层 | cardList: Card[]; characterIdList: number[]; attributeList: CardAttribute[] | Promise<Canvas> | 在QQBot 图片视图层中绘制Compact卡牌列表。 |
| 238 | outputCardListImage | function | 模块顶层 | cardListImage: Canvas; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中输出卡牌列表图片。 |
| 255 | getCardListByAttributeAndCharacterId | function | 模块顶层 | cardFullList: Card[]; attribute: CardAttribute; characterId: number | 推断 | 在QQBot 图片视图层中获取卡牌列表By属性And角色ID。 |
| 279 | drawCardListLine | function | 模块顶层 | cardList: Card[] | 推断 | 在QQBot 图片视图层中绘制卡牌列表线条。 |
| 288 | <anonymous> | callback | drawCardListLine | a: 推断; b: 推断 | 推断 | 作为 \`cardList.sort\` 的回调，处理 a、b。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 18 | maxWidth | const | 模块顶层 | 推断: FirstLiteralToken | 变量，在 模块顶层 中保存 最大值宽度 值，供当前逻辑读取或更新。 |
| 35 | tempCardList | const | drawCardList | Array<Card> | 保存 临时卡牌列表，用于按顺序遍历或批量渲染。 |
| 42 | characterIdList | const | drawCardList | 推断: CallExpression | 保存 角色ID列表，用于按顺序遍历或批量渲染。 |
| 42 | attributeList | const | drawCardList | 推断: CallExpression | 保存 属性列表，用于按顺序遍历或批量渲染。 |
| 45 | wideResult | const | drawCardList | 推断: AwaitExpression | 变量，在 drawCardList 中保存 wide结果 值，供当前逻辑读取或更新。 |
| 56 | compactImage | const | drawCardList | 推断: AwaitExpression | 保存 compact图片，用于图片绘制或输出。 |
| 65 | matchCardList | const | 模块顶层 | 推断: CallExpression | 保存 匹配卡牌列表，用于按顺序遍历或批量渲染。 |
| 109 | characterIdList | type-field | getCardListAxes | number[] | 保存 角色ID列表，用于按顺序遍历或批量渲染。 |
| 110 | attributeList | type-field | getCardListAxes | CardAttribute[] | 保存 属性列表，用于按顺序遍历或批量渲染。 |
| 112 | characterIdSet | const | getCardListAxes | 推断: NewExpression | 保存 角色ID集合 集合，用于去重或成员判断。 |
| 113 | attributeSet | const | getCardListAxes | 推断: NewExpression | 保存 属性集合 集合，用于去重或成员判断。 |
| 114 | card | const | getCardListAxes | 推断 | 保存当前卡牌领域模型实例。 |
| 131 | tempCanvas | const | drawCharacterIcon | 推断: NewExpression | 保存 临时画布，用于图片绘制或输出。 |
| 132 | ctx | const | drawCharacterIcon | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 136 | character | const | drawCharacterIcon | 推断: NewExpression | 保存当前角色领域模型实例。 |
| 137 | characterIcon | const | drawCharacterIcon | 推断: AwaitExpression | 变量，在 drawCharacterIcon 中保存 角色Icon 值，供当前逻辑读取或更新。 |
| 155 | characterIconImageList | const | drawWideCardList | Canvas[] | 保存 角色Icon图片列表，用于按顺序遍历或批量渲染。 |
| 156 | attributeImageList | const | drawWideCardList | Canvas[] | 保存 属性图片列表，用于按顺序遍历或批量渲染。 |
| 158 | attribute | const | drawWideCardList | 推断 | 变量，在 drawWideCardList 中保存 属性 值，供当前逻辑读取或更新。 |
| 159 | attributeCardImageList | const | drawWideCardList | Canvas[] | 保存 属性卡牌图片列表，用于按顺序遍历或批量渲染。 |
| 160 | characterId | const | drawWideCardList | 推断 | 保存 角色ID，用于定位对应业务实体。 |
| 161 | cards | const | drawWideCardList | 推断: CallExpression | 变量，在 drawWideCardList 中保存 卡牌列表 值，供当前逻辑读取或更新。 |
| 174 | characterIconImage | const | drawWideCardList | 推断: CallExpression | 保存 角色Icon图片，用于图片绘制或输出。 |
| 175 | columns | const | drawWideCardList | 推断: ArrayLiteralExpression | 变量，在 drawWideCardList 中保存 columns 值，供当前逻辑读取或更新。 |
| 176 | cardListImage | const | drawWideCardList | 推断: CallExpression | 保存 卡牌列表图片，用于图片绘制或输出。 |
| 181 | imageList | const | drawWideCardList | Array<Buffer \| string> | 保存 图片列表，用于按顺序遍历或批量渲染。 |
| 182 | column | const | drawWideCardList | 推断 | 变量，在 drawWideCardList 中保存 column 值，供当前逻辑读取或更新。 |
| 183 | buffer | const | drawWideCardList | 推断: AwaitExpression | 保存图片、SVG 或接口下载得到的二进制缓冲区。 |
| 204 | cardImageList | const | drawCompactCardList | Canvas[] | 保存 卡牌图片列表，用于按顺序遍历或批量渲染。 |
| 205 | characterIconImageList | const | drawCompactCardList | Canvas[] | 保存 角色Icon图片列表，用于按顺序遍历或批量渲染。 |
| 207 | characterId | const | drawCompactCardList | 推断 | 保存 角色ID，用于定位对应业务实体。 |
| 208 | shouldDrawIcon | let | drawCompactCardList | 推断: TrueKeyword | 布尔标记，表示 shouldDrawIcon 的判断结果。 |
| 209 | attribute | const | drawCompactCardList | 推断 | 变量，在 drawCompactCardList 中保存 属性 值，供当前逻辑读取或更新。 |
| 210 | cards | const | drawCompactCardList | 推断: CallExpression | 变量，在 drawCompactCardList 中保存 卡牌列表 值，供当前逻辑读取或更新。 |
| 260 | cardList | const | getCardListByAttributeAndCharacterId | Card[] | 保存 卡牌列表，用于按顺序遍历或批量渲染。 |
| 261 | i | let | getCardListByAttributeAndCharacterId | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 262 | tempCard | const | getCardListByAttributeAndCharacterId | 推断: ElementAccessExpression | 变量，在 getCardListByAttributeAndCharacterId 中保存 临时卡牌 值，供当前逻辑读取或更新。 |
| 283 | maxX | const | drawCardListLine | 推断: BinaryExpression | 变量，在 drawCardListLine 中保存 最大值横坐标 值，供当前逻辑读取或更新。 |
| 284 | maxY | const | drawCardListLine | 推断: FirstLiteralToken | 变量，在 drawCardListLine 中保存 最大值纵坐标 值，供当前逻辑读取或更新。 |
| 285 | canvas | const | drawCardListLine | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 286 | ctx | const | drawCardListLine | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 304 | i | let | drawCardListLine | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 305 | tempCard | const | drawCardListLine | 推断: ElementAccessExpression | 变量，在 drawCardListLine 中保存 临时卡牌 值，供当前逻辑读取或更新。 |
| 306 | cardIcon | const | drawCardListLine | 推断: AwaitExpression | 变量，在 drawCardListLine 中保存 卡牌Icon 值，供当前逻辑读取或更新。 |
| 312 | ratio | const | drawCardListLine | 推断: BinaryExpression | 变量，在 drawCardListLine 中保存 ratio 值，供当前逻辑读取或更新。 |

### command-renderers/character-detail.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 67 | drawCharacterDetail | function | 模块顶层 | characterId: number; displayedServerList: Server[]; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制角色详情。 |
| 103 | <anonymous> | callback | drawCharacterDetail | element: 推断 | 推断 | 作为 \`character.nickname.every\` 的回调，处理 element。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 31 | rightListWidth | const | 模块顶层 | 推断: FirstLiteralToken | 变量，在 模块顶层 中保存 right列表宽度 值，供当前逻辑读取或更新。 |
| 32 | rightListLine | const | 模块顶层 | Canvas | 变量，在 模块顶层 中保存 right列表Line 值，供当前逻辑读取或更新。 |
| 44 | constellationList | const | 模块顶层 | 推断: ObjectLiteralExpression | 保存 constellation列表，用于按顺序遍历或批量渲染。 |
| 72 | character | const | drawCharacterDetail | 推断: NewExpression | 保存当前角色领域模型实例。 |
| 77 | all | const | drawCharacterDetail | Array<Canvas \| Image> | 变量，在 drawCharacterDetail 中保存 all 值，供当前逻辑读取或更新。 |
| 79 | listRight | const | drawCharacterDetail | Array<Canvas \| Image> | 变量，在 drawCharacterDetail 中保存 列表Right 值，供当前逻辑读取或更新。 |
| 126 | tempColor | const | drawCharacterDetail | 推断: CallExpression | 变量，在 drawCharacterDetail 中保存 临时颜色 值，供当前逻辑读取或更新。 |
| 136 | imageLeft | const | drawCharacterDetail | 推断: CallExpression | 变量，在 drawCharacterDetail 中保存 图片Left 值，供当前逻辑读取或更新。 |
| 137 | characterHalfBlock | const | drawCharacterDetail | 推断: AwaitExpression | 变量，在 drawCharacterDetail 中保存 角色Half块 值，供当前逻辑读取或更新。 |
| 138 | imageUp | const | drawCharacterDetail | 推断: CallExpression | 变量，在 drawCharacterDetail 中保存 图片Up 值，供当前逻辑读取或更新。 |
| 145 | list | const | drawCharacterDetail | Array<Canvas \| Image> | 变量，在 drawCharacterDetail 中保存 列表 值，供当前逻辑读取或更新。 |
| 148 | tempServer | const | drawCharacterDetail | 推断: CallExpression | 变量，在 drawCharacterDetail 中保存 临时服务器 值，供当前逻辑读取或更新。 |
| 157 | band | const | drawCharacterDetail | 推断: NewExpression | 变量，在 drawCharacterDetail 中保存 乐队 值，供当前逻辑读取或更新。 |
| 166 | birthdayTextImage | const | drawCharacterDetail | 推断: CallExpression | 保存 birthday文本图片，用于图片绘制或输出。 |
| 171 | constellationTextImafe | const | drawCharacterDetail | 推断: CallExpression | 变量，在 drawCharacterDetail 中保存 constellation文本Imafe 值，供当前逻辑读取或更新。 |
| 178 | heightTextImage | const | drawCharacterDetail | 推断: CallExpression | 保存 高度文本图片，用于图片绘制或输出。 |
| 183 | partTextImage | const | drawCharacterDetail | 推断: CallExpression | 保存 part文本图片，用于图片绘制或输出。 |
| 200 | schoolYearTextImage | const | drawCharacterDetail | 推断: AwaitExpression | 保存 schoolYear文本图片，用于图片绘制或输出。 |
| 206 | schoolClsTextImage | const | drawCharacterDetail | 推断: AwaitExpression | 保存 schoolCls文本图片，用于图片绘制或输出。 |

### command-renderers/character-list.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 27 | drawCharacterList | function | 模块顶层 | matches: FuzzySearchResult; displayedServerList: Server[]; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制角色列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 17 | maxWidth | const | 模块顶层 | 推断: FirstLiteralToken | 变量，在 模块顶层 中保存 最大值宽度 值，供当前逻辑读取或更新。 |
| 33 | tempCharacterList | const | drawCharacterList | Array<Character> | 保存 临时角色列表，用于按顺序遍历或批量渲染。 |
| 34 | characterIdList | const | drawCharacterList | Array<number> | 保存 角色ID列表，用于按顺序遍历或批量渲染。 |
| 37 | i | let | drawCharacterList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 38 | tempCharacter | const | drawCharacterList | 推断: NewExpression | 变量，在 drawCharacterList 中保存 临时角色 值，供当前逻辑读取或更新。 |
| 39 | isMatch | let | drawCharacterList | 推断: CallExpression | 布尔标记，表示 is匹配 的判断结果。 |
| 41 | numberOfNotReleasedServer | let | drawCharacterList | 推断: FirstLiteralToken | 变量，在 drawCharacterList 中保存 数字OfNotReleased服务器 值，供当前逻辑读取或更新。 |
| 42 | j | let | drawCharacterList | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 43 | server | const | drawCharacterList | 推断: ElementAccessExpression | 保存当前目标服务器枚举或服务器代码。 |
| 66 | characterImageList | const | drawCharacterList | Canvas[] | 保存 角色图片列表，用于按顺序遍历或批量渲染。 |
| 67 | i | let | drawCharacterList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 68 | element | const | drawCharacterList | 推断: ElementAccessExpression | 变量，在 drawCharacterList 中保存 element 值，供当前逻辑读取或更新。 |
| 73 | characterListImage | const | drawCharacterList | 推断: CallExpression | 保存 角色列表图片，用于图片绘制或输出。 |
| 80 | all | const | drawCharacterList | 推断: ArrayLiteralExpression | 变量，在 drawCharacterList 中保存 all 值，供当前逻辑读取或更新。 |

### command-renderers/cutoff-all.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 27 | drawCutoffAll | function | 模块顶层 | eventId: number; mainServer: Server; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制档线全部。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 32 | event | const | drawCutoffAll | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 39 | all | const | drawCutoffAll | 推断: ArrayLiteralExpression | 变量，在 drawCutoffAll 中保存 all 值，供当前逻辑读取或更新。 |
| 43 | list | const | drawCutoffAll | Array<Image \| Canvas> | 变量，在 drawCutoffAll 中保存 列表 值，供当前逻辑读取或更新。 |
| 46 | tierList | const | drawCutoffAll | 推断: ElementAccessExpression | 保存 tier列表，用于按顺序遍历或批量渲染。 |
| 47 | cutoffList | const | drawCutoffAll | Array<Cutoff> | 保存 档线列表，用于按顺序遍历或批量渲染。 |
| 48 | i | const | drawCutoffAll | 推断 | 保存循环下标或对象键。 |
| 49 | tempCutoff | const | drawCutoffAll | 推断: NewExpression | 变量，在 drawCutoffAll 中保存 临时档线 值，供当前逻辑读取或更新。 |
| 67 | i | const | drawCutoffAll | 推断 | 保存循环下标或对象键。 |
| 68 | cutoff | const | drawCutoffAll | 推断: ElementAccessExpression | 变量，在 drawCutoffAll 中保存 档线 值，供当前逻辑读取或更新。 |
| 70 | cutoffContent | const | drawCutoffAll | string[] | 变量，在 drawCutoffAll 中保存 档线Content 值，供当前逻辑读取或更新。 |
| 72 | predictText | let | drawCutoffAll | string | 变量，在 drawCutoffAll 中保存 predict文本 值，供当前逻辑读取或更新。 |
| 102 | listImage | const | drawCutoffAll | 推断: CallExpression | 保存 列表图片，用于图片绘制或输出。 |

### command-renderers/cutoff-detail.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 30 | drawCutoffDetail | function | 模块顶层 | eventId: number; tier: number; mainServer: Server; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制档线详情。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 38 | event | const | drawCutoffDetail | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 39 | cutoff | const | drawCutoffDetail | 推断: NewExpression | 变量，在 drawCutoffDetail 中保存 档线 值，供当前逻辑读取或更新。 |
| 52 | all | const | drawCutoffDetail | 推断: ArrayLiteralExpression | 变量，在 drawCutoffDetail 中保存 all 值，供当前逻辑读取或更新。 |
| 56 | list | const | drawCutoffDetail | Array<Image \| Canvas> | 变量，在 drawCutoffDetail 中保存 列表 值，供当前逻辑读取或更新。 |
| 60 | time | const | drawCutoffDetail | 推断: CallExpression | 变量，在 drawCutoffDetail 中保存 时间 值，供当前逻辑读取或更新。 |
| 65 | predictText | const | drawCutoffDetail | 推断: ConditionalExpression | 变量，在 drawCutoffDetail 中保存 predict文本 值，供当前逻辑读取或更新。 |
| 71 | cutoffs | const | drawCutoffDetail | 推断: PropertyAccessExpression | 变量，在 drawCutoffDetail 中保存 档线列表 值，供当前逻辑读取或更新。 |
| 72 | lastEp | const | drawCutoffDetail | 推断: ConditionalExpression | 变量，在 drawCutoffDetail 中保存 lastEp 值，供当前逻辑读取或更新。 |
| 73 | timeSpan | const | drawCutoffDetail | 推断: BinaryExpression | 变量，在 drawCutoffDetail 中保存 时间Span 值，供当前逻辑读取或更新。 |
| 93 | tempImageList | const | drawCutoffDetail | 推断: ArrayLiteralExpression | 保存 临时图片列表，用于按顺序遍历或批量渲染。 |
| 95 | finalCutoffImage | const | drawCutoffDetail | 推断: CallExpression | 保存 最终档线图片，用于图片绘制或输出。 |
| 102 | finalTimeImage | const | drawCutoffDetail | 推断: CallExpression | 保存 最终时间图片，用于图片绘制或输出。 |
| 110 | tempList | const | drawCutoffDetail | 推断: ArrayLiteralExpression | 保存 临时列表，用于按顺序遍历或批量渲染。 |
| 158 | tempList | const | drawCutoffDetail | 推断: ArrayLiteralExpression | 保存 临时列表，用于按顺序遍历或批量渲染。 |
| 175 | listImage | const | drawCutoffDetail | 推断: CallExpression | 保存 列表图片，用于图片绘制或输出。 |

### command-renderers/cutoff-event-top.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 21 | drawCutoffEventTop | function | 模块顶层 | eventId: number; mainServer: Server; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制档线活动排名。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 26 | cutoffEventTop | const | drawCutoffEventTop | 推断: NewExpression | 变量，在 drawCutoffEventTop 中保存 档线活动Top 值，供当前逻辑读取或更新。 |
| 31 | all | const | drawCutoffEventTop | 推断: ArrayLiteralExpression | 变量，在 drawCutoffEventTop 中保存 all 值，供当前逻辑读取或更新。 |
| 33 | list | const | drawCutoffEventTop | Array<Image \| Canvas> | 变量，在 drawCutoffEventTop 中保存 列表 值，供当前逻辑读取或更新。 |
| 34 | event | const | drawCutoffEventTop | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 38 | userInRankings | const | drawCutoffEventTop | 推断: CallExpression | 变量，在 drawCutoffEventTop 中保存 userInRankings 值，供当前逻辑读取或更新。 |
| 39 | i | let | drawCutoffEventTop | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 40 | color | const | drawCutoffEventTop | 推断: ConditionalExpression | 变量，在 drawCutoffEventTop 中保存 颜色 值，供当前逻辑读取或更新。 |
| 41 | user | const | drawCutoffEventTop | 推断: CallExpression | 变量，在 drawCutoffEventTop 中保存 user 值，供当前逻辑读取或更新。 |
| 42 | playerRankingImage | const | drawCutoffEventTop | 推断: AwaitExpression | 保存 玩家Ranking图片，用于图片绘制或输出。 |
| 57 | listImage | const | drawCutoffEventTop | 推断: CallExpression | 保存 列表图片，用于图片绘制或输出。 |

### command-renderers/cutoff-list-of-recent-event.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 29 | drawCutoffListOfRecentEvent | function | 模块顶层 | eventId: number; tier: number; mainServer: Server; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制档线列表Of最近活动。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 36 | event | const | drawCutoffListOfRecentEvent | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 43 | tempcutoff | const | drawCutoffListOfRecentEvent | 推断: NewExpression | 变量，在 drawCutoffListOfRecentEvent 中保存 tempcutoff 值，供当前逻辑读取或更新。 |
| 48 | all | const | drawCutoffListOfRecentEvent | 推断: ArrayLiteralExpression | 变量，在 drawCutoffListOfRecentEvent 中保存 all 值，供当前逻辑读取或更新。 |
| 57 | list | const | drawCutoffListOfRecentEvent | Array<Image \| Canvas> | 变量，在 drawCutoffListOfRecentEvent 中保存 列表 值，供当前逻辑读取或更新。 |
| 60 | cutoffList | const | drawCutoffListOfRecentEvent | Array<Cutoff> | 保存 档线列表，用于按顺序遍历或批量渲染。 |
| 61 | eventList | const | drawCutoffListOfRecentEvent | 推断: CallExpression | 保存 活动列表，用于按顺序遍历或批量渲染。 |
| 67 | i | let | drawCutoffListOfRecentEvent | 推断: BinaryExpression | 保存循环下标或对象键。 |
| 68 | cutoff | const | drawCutoffListOfRecentEvent | 推断: NewExpression | 变量，在 drawCutoffListOfRecentEvent 中保存 档线 值，供当前逻辑读取或更新。 |
| 73 | i | const | drawCutoffListOfRecentEvent | 推断 | 保存循环下标或对象键。 |
| 74 | cutoff | const | drawCutoffListOfRecentEvent | 推断: ElementAccessExpression | 变量，在 drawCutoffListOfRecentEvent 中保存 档线 值，供当前逻辑读取或更新。 |
| 76 | tempEvent | const | drawCutoffListOfRecentEvent | 推断: NewExpression | 变量，在 drawCutoffListOfRecentEvent 中保存 临时活动 值，供当前逻辑读取或更新。 |
| 84 | attributeList | const | drawCutoffListOfRecentEvent | 推断: CallExpression | 保存 属性列表，用于按顺序遍历或批量渲染。 |
| 85 | i | const | drawCutoffListOfRecentEvent | 推断 | 保存循环下标或对象键。 |
| 87 | element | const | drawCutoffListOfRecentEvent | 推断: ElementAccessExpression | 变量，在 drawCutoffListOfRecentEvent 中保存 element 值，供当前逻辑读取或更新。 |
| 97 | characterList | const | drawCutoffListOfRecentEvent | 推断: CallExpression | 保存 角色列表，用于按顺序遍历或批量渲染。 |
| 98 | i | const | drawCutoffListOfRecentEvent | 推断 | 保存循环下标或对象键。 |
| 100 | element | const | drawCutoffListOfRecentEvent | 推断: ElementAccessExpression | 变量，在 drawCutoffListOfRecentEvent 中保存 element 值，供当前逻辑读取或更新。 |
| 109 | cutoffContent | const | drawCutoffListOfRecentEvent | Array<Canvas \| Image \| string> | 变量，在 drawCutoffListOfRecentEvent 中保存 档线Content 值，供当前逻辑读取或更新。 |
| 114 | predictText | let | drawCutoffListOfRecentEvent | string | 变量，在 drawCutoffListOfRecentEvent 中保存 predict文本 值，供当前逻辑读取或更新。 |
| 143 | listImage | const | drawCutoffListOfRecentEvent | 推断: CallExpression | 保存 列表图片，用于图片绘制或输出。 |

### search/entity-list-matcher.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 22 | hasOwn | arrow-function | hasOwn | source: object; key: string | 推断 | 在QQBot 图片视图层中判断对象是否包含指定自有属性。 |
| 31 | getMatchKeyCount | arrow-function | getMatchKeyCount | matches: FuzzySearchResult | number | 在QQBot 图片视图层中获取匹配KeyCount。 |
| 47 | getRelationList | arrow-function | getRelationList | matches: FuzzySearchResult | string[] \| undefined | 在QQBot 图片视图层中获取关系表达式列表。 |
| 58 | shouldCheckRelation | arrow-function | shouldCheckRelation | relationList: string[] \| undefined; relationOnly: boolean | 推断 | 在QQBot 图片视图层中判断是否需要Check关系表达式。 |
| 60 | <anonymous> | callback | shouldCheckRelation | baseMatched: boolean | 推断 | 作为 shouldCheckRelation 的内联回调，处理 baseMatched。 |
| 68 | createTsuguEntityMatcher | arrow-function | createTsuguEntityMatcher | options1: TsuguEntityMatcherOptions<T> | 推断 | 在QQBot 图片视图层中创建TsuguEntity匹配器。 |
| 77 | <anonymous> | callback | createTsuguEntityMatcher | matches: FuzzySearchResult; displayedServerList: Server[] | T[] | 作为 createTsuguEntityMatcher 的内联回调，处理 matches、displayedServerList。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 8 | source | type-field | 模块顶层 | Record<string, unknown> | 字段，在 模块顶层 中保存 来源 值，供当前逻辑读取或更新。 |
| 9 | createEntity | type-field | 模块顶层 | (id: number) => T | 字段，在 模块顶层 中保存 createEntity 值，供当前逻辑读取或更新。 |
| 10 | isCandidate | type-field | 模块顶层 | (entity: T) => boolean | 布尔标记，表示 isCandidate 的判断结果。 |
| 11 | isReleased | type-field | 模块顶层 | (entity: T, displayedServerList: Server[]) => boolean | 布尔标记，表示 isReleased 的判断结果。 |
| 12 | isMatched | type-field | 模块顶层 | (matches: FuzzySearchResult, entity: T) => boolean | 布尔标记，表示 isMatched 的判断结果。 |
| 13 | relationValue | type-field | 模块顶层 | (entity: T) => number | 字段，在 模块顶层 中保存 关系表达式值 值，供当前逻辑读取或更新。 |
| 22 | hasOwn | const | 模块顶层 | 推断: ArrowFunction | 布尔标记，表示 hasOwn 的判断结果。 |
| 31 | getMatchKeyCount | const | 模块顶层 | 推断: ArrowFunction | 变量，在 模块顶层 中保存 get匹配Key数量 值，供当前逻辑读取或更新。 |
| 32 | count | let | getMatchKeyCount | 推断: FirstLiteralToken | 变量，在 getMatchKeyCount 中保存 数量 值，供当前逻辑读取或更新。 |
| 33 | key | const | getMatchKeyCount | 推断 | 变量，在 getMatchKeyCount 中保存 key 值，供当前逻辑读取或更新。 |
| 47 | getRelationList | const | 模块顶层 | 推断: ArrowFunction | 保存 get关系表达式列表，用于按顺序遍历或批量渲染。 |
| 58 | shouldCheckRelation | const | 模块顶层 | 推断: ArrowFunction | 布尔标记，表示 shouldCheck关系表达式 的判断结果。 |
| 68 | createTsuguEntityMatcher | const | 模块顶层 | 推断: ArrowFunction | 变量，在 模块顶层 中保存 createTsuguEntityMatcher 值，供当前逻辑读取或更新。 |
| 78 | result | const | createTsuguEntityMatcher | T[] | 保存当前函数最终返回或阶段性处理结果。 |
| 79 | relationList | const | createTsuguEntityMatcher | 推断: CallExpression | 保存 关系表达式列表，用于按顺序遍历或批量渲染。 |
| 80 | relationOnly | const | createTsuguEntityMatcher | 推断: BinaryExpression | 变量，在 createTsuguEntityMatcher 中保存 关系表达式Only 值，供当前逻辑读取或更新。 |
| 82 | useRelation | const | createTsuguEntityMatcher | 推断: CallExpression | 变量，在 createTsuguEntityMatcher 中保存 use关系表达式 值，供当前逻辑读取或更新。 |
| 84 | id | const | createTsuguEntityMatcher | 推断 | 变量，在 createTsuguEntityMatcher 中保存 ID 值，供当前逻辑读取或更新。 |
| 89 | entity | const | createTsuguEntityMatcher | 推断: CallExpression | 变量，在 createTsuguEntityMatcher 中保存 entity 值，供当前逻辑读取或更新。 |
| 97 | baseMatched | const | createTsuguEntityMatcher | 推断: CallExpression | 变量，在 createTsuguEntityMatcher 中保存 基础Matched 值，供当前逻辑读取或更新。 |
| 98 | matched | const | createTsuguEntityMatcher | 推断: ConditionalExpression | 变量，在 createTsuguEntityMatcher 中保存 matched 值，供当前逻辑读取或更新。 |

### command-renderers/event-detail.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 58 | drawSongListDataBlock | function | 模块顶层 | songList: Song[]; topLeftText: string | 推断 | 在QQBot 图片视图层中绘制歌曲列表数据块。 |
| 74 | pushSection | function | 模块顶层 | list: Array<Image \| Canvas>; section: Image \| Canvas | 推断 | 在QQBot 图片视图层中推入区块。 |
| 86 | hasOwn | function | 模块顶层 | source: object; key: string | boolean | 在QQBot 图片视图层中判断对象是否包含指定自有属性。 |
| 96 | appendEventBonusSections | function | 模块顶层 | list: Array<Image \| Canvas>; event: Event | Promise<void> | 在QQBot 图片视图层中追加活动加成区块列表。 |
| 137 | getEventStatBonusText | function | 模块顶层 | event: Event | string | 在QQBot 图片视图层中获取活动数值加成文本。 |
| 158 | appendEventStatBonus | function | 模块顶层 | list: Array<Image \| Canvas>; event: Event | void | 在QQBot 图片视图层中追加活动数值加成。 |
| 179 | appendEventRewardSections | function | 模块顶层 | list: Array<Image \| Canvas>; event: Event; displayedServerList: Server[] | Promise<void> | 在QQBot 图片视图层中追加活动奖励区块列表。 |
| 212 | <anonymous> | callback | rewardCardList | cardId: 推断 | 推断 | 作为 \`event.rewardCards.map\` 的回调，处理 cardId。 |
| 232 | getEventMusicServer | function | 模块顶层 | event: Event; displayedServerList: Server[] | 推断 | 在QQBot 图片视图层中获取活动音乐服务器。 |
| 244 | appendEventMusicSection | function | 模块顶层 | list: Array<Image \| Canvas>; event: Event; displayedServerList: Server[] | Promise<void> | 在QQBot 图片视图层中追加活动音乐区块。 |
| 260 | <anonymous> | callback | songs | music: 推断 | 推断 | 作为 \`event.musics[musicServer].map\` 的回调，处理 music。 |
| 277 | collectEventGachaSections | function | 模块顶层 | event: Event; displayedServerList: Server[] | Promise<EventGachaSections> | 在QQBot 图片视图层中收集活动卡池区块列表。 |
| 325 | getSongListSignature | function | 模块顶层 | songList: Song[] | string | 在QQBot 图片视图层中获取歌曲列表Signature。 |
| 326 | <anonymous> | callback | getSongListSignature | song: 推断 | 推断 | 作为 \`songList.map\` 的回调，处理 song。 |
| 336 | appendRelatedSongSections | function | 模块顶层 | all: Array<Image \| Canvas>; event: Event; displayedServerList: Server[] | Promise<void> | 在QQBot 图片视图层中追加Related歌曲区块列表。 |
| 379 | drawEventDetail | function | 模块顶层 | eventId: number; displayedServerList: Server[]; useEasyBG: boolean; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制活动详情。 |
| 504 | getEventGachaAndCardList | function | 模块顶层 | event: Event; mainServer: Server; useCache: 推断 | 推断 | 在QQBot 图片视图层中获取活动卡池And卡牌列表。 |
| 568 | <anonymous> | callback | getEventGachaAndCardList | a: 推断; b: 推断 | 推断 | 作为 \`gachaCardList.sort\` 的回调，处理 a、b。 |
| 571 | <anonymous> | callback | getEventGachaAndCardList | a: 推断; b: 推断 | 推断 | 作为 \`gachaList.sort\` 的回调，处理 a、b。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 40 | songSeparatorLine | const | 模块顶层 | 推断: CallExpression | 变量，在 模块顶层 中保存 歌曲SeparatorLine 值，供当前逻辑读取或更新。 |
| 59 | list | const | drawSongListDataBlock | Array<Image \| Canvas> | 变量，在 drawSongListDataBlock 中保存 列表 值，供当前逻辑读取或更新。 |
| 60 | song | const | drawSongListDataBlock | 推断 | 保存当前歌曲领域模型实例。 |
| 101 | attributeList | const | appendEventBonusSections | 推断: CallExpression | 保存 属性列表，用于按顺序遍历或批量渲染。 |
| 102 | percent | const | appendEventBonusSections | 推断 | 变量，在 appendEventBonusSections 中保存 percent 值，供当前逻辑读取或更新。 |
| 116 | characterList | const | appendEventBonusSections | 推断: CallExpression | 保存 角色列表，用于按顺序遍历或批量渲染。 |
| 117 | percent | const | appendEventBonusSections | 推断 | 变量，在 appendEventBonusSections 中保存 percent 值，供当前逻辑读取或更新。 |
| 138 | statText | const | getEventStatBonusText | string[] | 变量，在 getEventStatBonusText 中保存 数值文本 值，供当前逻辑读取或更新。 |
| 139 | key | const | getEventStatBonusText | 推断 | 变量，在 getEventStatBonusText 中保存 key 值，供当前逻辑读取或更新。 |
| 143 | element | const | getEventStatBonusText | 推断: ElementAccessExpression | 变量，在 getEventStatBonusText 中保存 element 值，供当前逻辑读取或更新。 |
| 159 | statText | const | appendEventStatBonus | 推断: CallExpression | 变量，在 appendEventStatBonus 中保存 数值文本 值，供当前逻辑读取或更新。 |
| 184 | decoImage | const | appendEventRewardSections | 推断: AwaitExpression | 保存 deco图片，用于图片绘制或输出。 |
| 199 | stampImage | const | appendEventRewardSections | 推断: AwaitExpression | 保存 stamp图片，用于图片绘制或输出。 |
| 212 | rewardCardList | const | appendEventRewardSections | 推断: CallExpression | 保存 奖励卡牌列表，用于按顺序遍历或批量渲染。 |
| 233 | defaultServer | const | getEventMusicServer | 推断: ElementAccessExpression | 变量，在 getEventMusicServer 中保存 default服务器 值，供当前逻辑读取或更新。 |
| 249 | eventTypes | const | appendEventMusicSection | string[] | 变量，在 appendEventMusicSection 中保存 活动类型列表 值，供当前逻辑读取或更新。 |
| 258 | musicServer | const | appendEventMusicSection | 推断: CallExpression | 变量，在 appendEventMusicSection 中保存 音乐服务器 值，供当前逻辑读取或更新。 |
| 259 | songs | const | appendEventMusicSection | 推断: CallExpression | 变量，在 appendEventMusicSection 中保存 歌曲列表 值，供当前逻辑读取或更新。 |
| 266 | gachaCardList | type-field | 模块顶层 | Card[] | 保存 卡池卡牌列表，用于按顺序遍历或批量渲染。 |
| 267 | gachaImageList | type-field | 模块顶层 | Canvas[] | 保存 卡池图片列表，用于按顺序遍历或批量渲染。 |
| 281 | gachaCardList | const | collectEventGachaSections | Card[] | 保存 卡池卡牌列表，用于按顺序遍历或批量渲染。 |
| 282 | gachaCardIdSet | const | collectEventGachaSections | 推断: NewExpression | 保存 卡池卡牌ID集合 集合，用于去重或成员判断。 |
| 283 | gachaImageList | const | collectEventGachaSections | Canvas[] | 保存 卡池图片列表，用于按顺序遍历或批量渲染。 |
| 284 | gachaIdSet | const | collectEventGachaSections | 推断: NewExpression | 保存 卡池ID集合 集合，用于去重或成员判断。 |
| 286 | server | const | collectEventGachaSections | 推断 | 保存当前目标服务器枚举或服务器代码。 |
| 290 | gachaList | const | collectEventGachaSections | 推断: AwaitExpression | 保存 卡池列表，用于按顺序遍历或批量渲染。 |
| 290 | serverGachaCardList | const | collectEventGachaSections | 推断: AwaitExpression | 保存 服务器卡池卡牌列表，用于按顺序遍历或批量渲染。 |
| 293 | i | let | collectEventGachaSections | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 294 | gacha | const | collectEventGachaSections | 推断: ElementAccessExpression | 保存当前卡池领域模型实例。 |
| 307 | card | const | collectEventGachaSections | 推断 | 保存当前卡牌领域模型实例。 |
| 341 | songSignatures | const | appendRelatedSongSections | 推断: NewExpression | 变量，在 appendRelatedSongSections 中保存 歌曲Signatures 值，供当前逻辑读取或更新。 |
| 343 | server | const | appendRelatedSongSections | 推断 | 保存当前目标服务器枚举或服务器代码。 |
| 347 | songList | const | appendRelatedSongSections | 推断: CallExpression | 保存 歌曲列表，用于按顺序遍历或批量渲染。 |
| 356 | signature | const | appendRelatedSongSections | 推断: CallExpression | 变量，在 appendRelatedSongSections 中保存 signature 值，供当前逻辑读取或更新。 |
| 385 | event | const | drawEventDetail | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 390 | list | const | drawEventDetail | Array<Image \| Canvas> | 变量，在 drawEventDetail 中保存 列表 值，供当前逻辑读取或更新。 |
| 393 | eventBannerImage | const | drawEventDetail | 推断: AwaitExpression | 保存 活动横幅图片，用于图片绘制或输出。 |
| 394 | eventBannerImageCanvas | const | drawEventDetail | 推断: CallExpression | 保存 活动横幅图片画布，用于图片绘制或输出。 |
| 409 | typeImage | const | drawEventDetail | 推断: CallExpression | 保存 类型图片，用于图片绘制或输出。 |
| 415 | idImage | const | drawEventDetail | 推断: CallExpression | 保存 ID图片，用于图片绘制或输出。 |
| 455 | gachaCardList | const | drawEventDetail | 推断: AwaitExpression | 保存 卡池卡牌列表，用于按顺序遍历或批量渲染。 |
| 455 | gachaImageList | const | drawEventDetail | 推断: AwaitExpression | 保存 卡池图片列表，用于按顺序遍历或批量渲染。 |
| 471 | listImage | const | drawEventDetail | 推断: CallExpression | 保存 列表图片，用于图片绘制或输出。 |
| 474 | all | const | drawEventDetail | 推断: ArrayLiteralExpression | 变量，在 drawEventDetail 中保存 all 值，供当前逻辑读取或更新。 |
| 483 | i | let | drawEventDetail | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 487 | BGimage | const | drawEventDetail | 推断: AwaitExpression | 变量，在 drawEventDetail 中保存 BGimage 值，供当前逻辑读取或更新。 |
| 509 | gachaList | const | getEventGachaAndCardList | Gacha[] | 保存 卡池列表，用于按顺序遍历或批量渲染。 |
| 510 | gachaIdList | const | getEventGachaAndCardList | 推断: ArrayLiteralExpression | 保存 卡池ID列表，用于按顺序遍历或批量渲染。 |
| 514 | tempGachaList | const | getEventGachaAndCardList | 推断: AwaitExpression | 保存 临时卡池列表，用于按顺序遍历或批量渲染。 |
| 519 | j | let | getEventGachaAndCardList | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 525 | gachaCardIdList | const | getEventGachaAndCardList | number[] | 保存 卡池卡牌ID列表，用于按顺序遍历或批量渲染。 |
| 526 | i | let | getEventGachaAndCardList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 527 | tempGacha | const | getEventGachaAndCardList | 推断: ElementAccessExpression | 变量，在 getEventGachaAndCardList 中保存 临时卡池 值，供当前逻辑读取或更新。 |
| 532 | tempCardList | const | getEventGachaAndCardList | 推断: PropertyAccessExpression | 保存 临时卡牌列表，用于按顺序遍历或批量渲染。 |
| 546 | j | let | getEventGachaAndCardList | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 547 | tempCardId | const | getEventGachaAndCardList | 推断: ElementAccessExpression | 保存 临时卡牌ID，用于定位对应业务实体。 |
| 553 | gachaCardList | const | getEventGachaAndCardList | Card[] | 保存 卡池卡牌列表，用于按顺序遍历或批量渲染。 |
| 554 | i | let | getEventGachaAndCardList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 555 | tempCardId | const | getEventGachaAndCardList | 推断: ElementAccessExpression | 保存 临时卡牌ID，用于定位对应业务实体。 |
| 556 | tempCard | const | getEventGachaAndCardList | 推断: NewExpression | 变量，在 getEventGachaAndCardList 中保存 临时卡牌 值，供当前逻辑读取或更新。 |

### command-renderers/event-list.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 66 | drawEventList | function | 模块顶层 | matches: FuzzySearchResult; displayedServerList: Server[]; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制活动列表。 |
| 85 | <anonymous> | callback | drawEventList | image: 推断 | 推断 | 作为 \`drawEventInList(tempEventList[i], displayedServerList).then\` 的回调，处理 image。 |
| 94 | <anonymous> | callback | drawEventList | a: 推断; b: 推断 | 推断 | 作为 \`eventResults.sort\` 的回调，处理 a、b。 |
| 153 | createEntity | arrow-function | matchEventList | eventId: 推断 | 推断 | 在QQBot 图片视图层中创建Entity。 |
| 160 | isReleased | arrow-function | matchEventList | event: 推断; displayedServerList: 推断 | 推断 | 在QQBot 图片视图层中判断Released。 |
| 161 | <anonymous> | callback | matchEventList | server: 推断 | 推断 | 作为 \`displayedServerList.some\` 的回调，处理 server。 |
| 168 | isMatched | arrow-function | matchEventList | matches: 推断; event: 推断 | 推断 | 在QQBot 图片视图层中判断Matched。 |
| 174 | relationValue | arrow-function | matchEventList | event: 推断 | 推断 | 在QQBot 图片视图层中处理关系表达式值。 |
| 184 | drawEventInList | function | 模块顶层 | event: Event; displayedServerList: Server[] | Promise<Canvas> | 在QQBot 图片视图层中绘制活动In列表。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 42 | maxHeight | const | 模块顶层 | 推断: FirstLiteralToken | 变量，在 模块顶层 中保存 最大值高度 值，供当前逻辑读取或更新。 |
| 43 | maxColumns | const | 模块顶层 | 推断: FirstLiteralToken | 变量，在 模块顶层 中保存 最大值Columns 值，供当前逻辑读取或更新。 |
| 46 | line2 | const | 模块顶层 | Canvas | 变量，在 模块顶层 中保存 line2 值，供当前逻辑读取或更新。 |
| 72 | tempEventList | const | drawEventList | 推断: CallExpression | 保存 临时活动列表，用于按顺序遍历或批量渲染。 |
| 80 | eventPromises | const | drawEventList | Promise<{ index: number; image: Canvas }>[] | 变量，在 drawEventList 中保存 活动异步任务列表 值，供当前逻辑读取或更新。 |
| 80 | index | type-field | eventPromises | number | 字段，在 eventPromises 中保存 下标 值，供当前逻辑读取或更新。 |
| 80 | image | type-field | eventPromises | Canvas | 保存当前加载或绘制的图片对象。 |
| 81 | tempH | let | drawEventList | 推断: FirstLiteralToken | 变量，在 drawEventList 中保存 临时H 值，供当前逻辑读取或更新。 |
| 83 | i | let | drawEventList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 92 | eventResults | const | drawEventList | 推断: AwaitExpression | 变量，在 drawEventList 中保存 活动结果列表 值，供当前逻辑读取或更新。 |
| 96 | tempEventImageList | let | drawEventList | Canvas[] | 保存 临时活动图片列表，用于按顺序遍历或批量渲染。 |
| 97 | eventImageListHorizontal | const | drawEventList | Canvas[] | 变量，在 drawEventList 中保存 活动图片列表Horizontal 值，供当前逻辑读取或更新。 |
| 99 | i | let | drawEventList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 100 | tempImage | const | drawEventList | 推断: PropertyAccessExpression | 保存 临时图片，用于图片绘制或输出。 |
| 122 | tempImageList | const | drawEventList | Array<string \| Buffer> | 保存 临时图片列表，用于按顺序遍历或批量渲染。 |
| 124 | i | let | drawEventList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 125 | tempCanvas | const | drawEventList | 推断: ElementAccessExpression | 保存 临时画布，用于图片绘制或输出。 |
| 129 | all | const | drawEventList | 推断: ArrayLiteralExpression | 变量，在 drawEventList 中保存 all 值，供当前逻辑读取或更新。 |
| 131 | buffer | const | drawEventList | 推断: AwaitExpression | 保存图片、SVG 或接口下载得到的二进制缓冲区。 |
| 136 | all | const | drawEventList | 推断: ArrayLiteralExpression | 变量，在 drawEventList 中保存 all 值，供当前逻辑读取或更新。 |
| 137 | eventListImage | const | drawEventList | 推断: CallExpression | 保存 活动列表图片，用于图片绘制或输出。 |
| 146 | matchEventList | const | 模块顶层 | 推断: CallExpression | 保存 匹配活动列表，用于按顺序遍历或批量渲染。 |
| 189 | textSize | const | drawEventInList | 推断: BinaryExpression | 变量，在 drawEventInList 中保存 文本Size 值，供当前逻辑读取或更新。 |
| 190 | content | const | drawEventInList | 推断: ArrayLiteralExpression | 变量，在 drawEventInList 中保存 content 值，供当前逻辑读取或更新。 |
| 196 | numberOfServer | const | drawEventInList | 推断: CallExpression | 变量，在 drawEventInList 中保存 数字Of服务器 值，供当前逻辑读取或更新。 |
| 197 | currentEvent | const | drawEventInList | 推断: CallExpression | 变量，在 drawEventInList 中保存 当前项活动 值，供当前逻辑读取或更新。 |
| 198 | i | let | drawEventInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 199 | server | const | drawEventInList | 推断: ElementAccessExpression | 保存当前目标服务器枚举或服务器代码。 |
| 215 | attributeList | const | drawEventInList | 推断: CallExpression | 保存 属性列表，用于按顺序遍历或批量渲染。 |
| 216 | percent | const | drawEventInList | 推断 | 变量，在 drawEventInList 中保存 percent 值，供当前逻辑读取或更新。 |
| 217 | i | let | drawEventInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 224 | characterList | const | drawEventInList | 推断: CallExpression | 保存 角色列表，用于按顺序遍历或批量渲染。 |
| 225 | percent | const | drawEventInList | 推断 | 变量，在 drawEventInList 中保存 percent 值，供当前逻辑读取或更新。 |
| 226 | i | let | drawEventInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 234 | statText | let | drawEventInList | 推断: StringLiteral | 变量，在 drawEventInList 中保存 数值文本 值，供当前逻辑读取或更新。 |
| 235 | i | const | drawEventInList | 推断 | 保存循环下标或对象键。 |
| 245 | element | const | drawEventInList | 推断: ElementAccessExpression | 变量，在 drawEventInList 中保存 element 值，供当前逻辑读取或更新。 |
| 255 | textImage | const | drawEventInList | 推断: CallExpression | 保存 文本图片，用于图片绘制或输出。 |
| 260 | eventBannerImage | const | drawEventInList | 推断: CallExpression | 保存 活动横幅图片，用于图片绘制或输出。 |
| 264 | imageUp | const | drawEventInList | 推断: CallExpression | 变量，在 drawEventInList 中保存 图片Up 值，供当前逻辑读取或更新。 |
| 271 | cardList | const | drawEventInList | Card[] | 保存 卡牌列表，用于按顺序遍历或批量渲染。 |
| 272 | cardIdList | const | drawEventInList | number[] | 保存 卡牌ID列表，用于按顺序遍历或批量渲染。 |
| 273 | i | let | drawEventInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 274 | server | const | drawEventInList | 推断: ElementAccessExpression | 保存当前目标服务器枚举或服务器代码。 |
| 275 | EventGachaAndCardList | const | drawEventInList | 推断: AwaitExpression | 保存 活动卡池And卡牌列表，用于按顺序遍历或批量渲染。 |
| 280 | tempGachaCardList | const | drawEventInList | 推断: PropertyAccessExpression | 保存 临时卡池卡牌列表，用于按顺序遍历或批量渲染。 |
| 281 | i | let | drawEventInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 282 | tempCard | const | drawEventInList | 推断: ElementAccessExpression | 变量，在 drawEventInList 中保存 临时卡牌 值，供当前逻辑读取或更新。 |
| 290 | rewardCards | const | drawEventInList | 推断: PropertyAccessExpression | 变量，在 drawEventInList 中保存 奖励卡牌列表 值，供当前逻辑读取或更新。 |
| 291 | i | let | drawEventInList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 294 | imageDown | const | drawEventInList | 推断: AwaitExpression | 变量，在 drawEventInList 中保存 图片Down 值，供当前逻辑读取或更新。 |

### command-renderers/event-stage.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 30 | drawEventStage | function | 模块顶层 | eventId: number; mainServer: Server; meta: boolean; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制活动试炼。 |
| 69 | drawStageSong | function | drawEventStage | stage: Stage | 推断 | 在QQBot 图片视图层中绘制试炼歌曲。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 36 | event | const | drawEventStage | 推断: NewExpression | 保存当前活动领域模型实例。 |
| 49 | eventStage | const | drawEventStage | 推断: NewExpression | 变量，在 drawEventStage 中保存 活动试炼 值，供当前逻辑读取或更新。 |
| 55 | all | const | drawEventStage | 推断: ArrayLiteralExpression | 变量，在 drawEventStage 中保存 all 值，供当前逻辑读取或更新。 |
| 59 | stageList | const | drawEventStage | 推断: CallExpression | 保存 试炼列表，用于按顺序遍历或批量渲染。 |
| 61 | eventStagePromises | const | drawEventStage | 推断: ArrayLiteralExpression | 变量，在 drawEventStage 中保存 活动试炼异步任务列表 值，供当前逻辑读取或更新。 |
| 76 | i | let | drawEventStage | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 77 | stage | const | drawEventStage | 推断: ElementAccessExpression | 变量，在 drawEventStage 中保存 试炼 值，供当前逻辑读取或更新。 |
| 81 | eventStageResults | const | drawEventStage | 推断: AwaitExpression | 变量，在 drawEventStage 中保存 活动试炼结果列表 值，供当前逻辑读取或更新。 |
| 84 | tempH | let | drawEventStage | 推断: FirstLiteralToken | 变量，在 drawEventStage 中保存 临时H 值，供当前逻辑读取或更新。 |
| 85 | maxHeight | const | drawEventStage | 推断: FirstLiteralToken | 变量，在 drawEventStage 中保存 最大值高度 值，供当前逻辑读取或更新。 |
| 87 | tempEventStageImageList | let | drawEventStage | Canvas[] | 保存 临时活动试炼图片列表，用于按顺序遍历或批量渲染。 |
| 88 | eventStageImageListHorizontal | const | drawEventStage | Canvas[] | 变量，在 drawEventStage 中保存 活动试炼图片列表Horizontal 值，供当前逻辑读取或更新。 |
| 90 | i | let | drawEventStage | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 91 | tempImage | const | drawEventStage | 推断: ElementAccessExpression | 保存 临时图片，用于图片绘制或输出。 |
| 111 | eventStageListImage | const | drawEventStage | 推断: CallExpression | 保存 活动试炼列表图片，用于图片绘制或输出。 |

### command-renderers/gacha-detail.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 37 | drawGachaDetail | function | 模块顶层 | gachaId: number; displayedServerList: Server[]; useEasyBG: boolean; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制卡池详情。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 43 | gacha | const | drawGachaDetail | 推断: NewExpression | 保存当前卡池领域模型实例。 |
| 48 | list | const | drawGachaDetail | Array<Image \| Canvas> | 变量，在 drawGachaDetail 中保存 列表 值，供当前逻辑读取或更新。 |
| 50 | gachaBannerImage | const | drawGachaDetail | 推断: AwaitExpression | 保存 卡池横幅图片，用于图片绘制或输出。 |
| 51 | gachaBannerImageCanvas | const | drawGachaDetail | 推断: CallExpression | 保存 卡池横幅图片画布，用于图片绘制或输出。 |
| 66 | typeImage | const | drawGachaDetail | 推断: CallExpression | 保存 类型图片，用于图片绘制或输出。 |
| 72 | idImage | const | drawGachaDetail | 推断: CallExpression | 保存 ID图片，用于图片绘制或输出。 |
| 104 | server | const | drawGachaDetail | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 119 | listImage | const | drawGachaDetail | 推断: CallExpression | 保存 列表图片，用于图片绘制或输出。 |
| 120 | all | const | drawGachaDetail | 推断: ArrayLiteralExpression | 变量，在 drawGachaDetail 中保存 all 值，供当前逻辑读取或更新。 |
| 125 | tempEventIdList | const | drawGachaDetail | 推断: ArrayLiteralExpression | 保存 临时活动ID列表，用于按顺序遍历或批量渲染。 |
| 126 | eventImageList | const | drawGachaDetail | Array<Canvas \| Image> | 保存 活动图片列表，用于按顺序遍历或批量渲染。 |
| 128 | k | let | drawGachaDetail | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 129 | server | const | drawGachaDetail | 推断: ElementAccessExpression | 保存当前目标服务器枚举或服务器代码。 |
| 133 | relatedEvent | const | drawGachaDetail | 推断: CallExpression | 变量，在 drawGachaDetail 中保存 related活动 值，供当前逻辑读取或更新。 |
| 149 | i | let | drawGachaDetail | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 152 | gachaBGImage | const | drawGachaDetail | 推断: AwaitExpression | 保存 卡池BG图片，用于图片绘制或输出。 |

### command-renderers/gacha-simulate.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 25 | drawRandomGacha | function | 模块顶层 | gacha: Gacha; times: number; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制Random卡池。 |
| 59 | <anonymous> | callback | drawRandomGacha | - | 推断 | 作为立即执行函数的回调，处理 当前值。 |
| 74 | <anonymous> | callback | drawRandomGacha | a: 推断; b: 推断 | 推断 | 作为 \`cardIdList.sort\` 的回调，处理 a、b。 |
| 121 | drawGachaCard | function | 模块顶层 | card: Card; numberOfCard: number | 推断 | 在QQBot 图片视图层中绘制卡池卡牌。 |
| 171 | getGachaRandomCard | function | 模块顶层 | gacha: Gacha; times: number | 推断 | 在QQBot 图片视图层中获取卡池Random卡牌。 |
| 191 | randomNumber | function | 模块顶层 | max: number | 推断 | 在QQBot 图片视图层中处理random数字。 |
| 202 | getCardByWeight | function | 模块顶层 | Rarity: number; totalWeight: number; cardWeightList: { [cardId: string]: { rarityIndex: number; weight: number } } | 推断 | 在QQBot 图片视图层中获取卡牌ByWeight。 |
| 230 | getRandomRarity | function | 模块顶层 | rarities: { [rarity: string]: { rate: number; weightTotal: number }; } | string \| null | 在QQBot 图片视图层中获取RandomRarity。 |
| 278 | drawGachaBanner | function | 模块顶层 | gacha: Gacha | 推断 | 在QQBot 图片视图层中绘制卡池横幅。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 16 | maxWidth | const | 模块顶层 | 推断: BinaryExpression | 变量，在 模块顶层 中保存 最大值宽度 值，供当前逻辑读取或更新。 |
| 40 | gachaImage | let | drawRandomGacha | Canvas | 保存 卡池图片，用于图片绘制或输出。 |
| 42 | cardImageList | const | drawRandomGacha | Canvas[] | 保存 卡牌图片列表，用于按顺序遍历或批量渲染。 |
| 43 | i | let | drawRandomGacha | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 54 | gachaList | const | drawRandomGacha | { [cardId: number]: number } | 保存 卡池列表，用于按顺序遍历或批量渲染。 |
| 55 | promises | const | drawRandomGacha | Promise<void>[] | 保存异步任务列表，用于批量等待并发流程完成。 |
| 57 | i | let | drawRandomGacha | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 60 | card | const | drawRandomGacha | 推断: CallExpression | 保存当前卡牌领域模型实例。 |
| 72 | cardImageList | const | drawRandomGacha | Canvas[] | 保存 卡牌图片列表，用于按顺序遍历或批量渲染。 |
| 73 | cardIdList | const | drawRandomGacha | 推断: CallExpression | 保存 卡牌ID列表，用于按顺序遍历或批量渲染。 |
| 75 | cardA | const | drawRandomGacha | 推断: NewExpression | 变量，在 drawRandomGacha 中保存 卡牌A 值，供当前逻辑读取或更新。 |
| 76 | cardB | const | drawRandomGacha | 推断: NewExpression | 变量，在 drawRandomGacha 中保存 卡牌B 值，供当前逻辑读取或更新。 |
| 80 | cardPromises | const | drawRandomGacha | Promise<Canvas>[] | 变量，在 drawRandomGacha 中保存 卡牌异步任务列表 值，供当前逻辑读取或更新。 |
| 81 | i | let | drawRandomGacha | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 82 | cardId | const | drawRandomGacha | 推断: ElementAccessExpression | 保存 卡牌ID，用于定位对应业务实体。 |
| 84 | card | const | drawRandomGacha | 推断: NewExpression | 保存当前卡牌领域模型实例。 |
| 89 | cardImageResults | const | drawRandomGacha | 推断: AwaitExpression | 变量，在 drawRandomGacha 中保存 卡牌图片结果列表 值，供当前逻辑读取或更新。 |
| 101 | all | const | drawRandomGacha | 推断: ArrayLiteralExpression | 变量，在 drawRandomGacha 中保存 all 值，供当前逻辑读取或更新。 |
| 122 | cardIconWithId | const | drawGachaCard | 推断: AwaitExpression | 保存 卡牌IconWithID，用于定位对应业务实体。 |
| 129 | canvas | const | drawGachaCard | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 130 | ctx | const | drawGachaCard | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 131 | maxTimes | const | drawGachaCard | 推断: CallExpression | 变量，在 drawGachaCard 中保存 最大值时间列表 值，供当前逻辑读取或更新。 |
| 132 | cardIconWithoutId | const | drawGachaCard | 推断: AwaitExpression | 保存 卡牌IconWithoutID，用于定位对应业务实体。 |
| 138 | i | let | drawGachaCard | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 148 | numberText | const | drawGachaCard | 推断: CallExpression | 变量，在 drawGachaCard 中保存 数字文本 值，供当前逻辑读取或更新。 |
| 157 | canvas | const | drawGachaCard | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 158 | ctx | const | drawGachaCard | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |
| 172 | server | const | getGachaRandomCard | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 173 | gachaDetails | const | getGachaRandomCard | 推断: ElementAccessExpression | 变量，在 getGachaRandomCard 中保存 卡池详情列表 值，供当前逻辑读取或更新。 |
| 174 | gachaRates | const | getGachaRandomCard | 推断: ElementAccessExpression | 变量，在 getGachaRandomCard 中保存 卡池概率列表 值，供当前逻辑读取或更新。 |
| 176 | cardRarity | let | getGachaRandomCard | 推断: CallExpression | 变量，在 getGachaRandomCard 中保存 卡牌Rarity 值，供当前逻辑读取或更新。 |
| 181 | rarityTotalWeight | const | getGachaRandomCard | 推断: PropertyAccessExpression | 变量，在 getGachaRandomCard 中保存 rarityTotalWeight 值，供当前逻辑读取或更新。 |
| 182 | cardId | const | getGachaRandomCard | 推断: CallExpression | 保存 卡牌ID，用于定位对应业务实体。 |
| 183 | card | const | getGachaRandomCard | 推断: NewExpression | 保存当前卡牌领域模型实例。 |
| 205 | rarityIndex | type-field | getCardByWeight | number | 字段，在 getCardByWeight 中保存 rarity下标 值，供当前逻辑读取或更新。 |
| 205 | weight | type-field | getCardByWeight | number | 字段，在 getCardByWeight 中保存 weight 值，供当前逻辑读取或更新。 |
| 207 | randomNum | const | getCardByWeight | 推断: CallExpression | 变量，在 getCardByWeight 中保存 randomNum 值，供当前逻辑读取或更新。 |
| 208 | currentWeight | let | getCardByWeight | 推断: FirstLiteralToken | 变量，在 getCardByWeight 中保存 当前项Weight 值，供当前逻辑读取或更新。 |
| 209 | key | const | getCardByWeight | 推断 | 变量，在 getCardByWeight 中保存 key 值，供当前逻辑读取或更新。 |
| 214 | card | const | getCardByWeight | 推断: ElementAccessExpression | 保存当前卡牌领域模型实例。 |
| 231 | rate | type-field | getRandomRarity | number | 字段，在 getRandomRarity 中保存 概率 值，供当前逻辑读取或更新。 |
| 231 | weightTotal | type-field | getRandomRarity | number | 字段，在 getRandomRarity 中保存 weightTotal 值，供当前逻辑读取或更新。 |
| 233 | totalRate | let | getRandomRarity | 推断: FirstLiteralToken | 变量，在 getRandomRarity 中保存 total概率 值，供当前逻辑读取或更新。 |
| 235 | key | const | getRandomRarity | 推断 | 变量，在 getRandomRarity 中保存 key 值，供当前逻辑读取或更新。 |
| 242 | randomNum | const | getRandomRarity | 推断: CallExpression | 变量，在 getRandomRarity 中保存 randomNum 值，供当前逻辑读取或更新。 |
| 244 | currentRate | let | getRandomRarity | 推断: FirstLiteralToken | 变量，在 getRandomRarity 中保存 当前项概率 值，供当前逻辑读取或更新。 |
| 246 | key | const | getRandomRarity | 推断 | 变量，在 getRandomRarity 中保存 key 值，供当前逻辑读取或更新。 |
| 248 | rarity | const | getRandomRarity | 推断: ElementAccessExpression | 变量，在 getRandomRarity 中保存 rarity 值，供当前逻辑读取或更新。 |
| 279 | gachaBannerImage | const | drawGachaBanner | 推断: CallExpression | 保存 卡池横幅图片，用于图片绘制或输出。 |
| 283 | canvas | const | drawGachaBanner | 推断: NewExpression | 保存当前 Skia 画布实例，用于承载图片绘制结果。 |
| 284 | ctx | const | drawGachaBanner | 推断: CallExpression | 保存当前画布的 2D 绘图上下文，用于后续绘制文本、图片或形状。 |

### command-renderers/player-detail.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 28 | loadImageOnce | function | 模块顶层 | - | 推断 | 在QQBot 图片视图层中加载图片Once。 |
| 44 | drawPlayerDetail | function | 模块顶层 | playerId: number; mainServer: Server; useEasyBG: boolean; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制玩家详情。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 24 | BGDefaultImage | let | 模块顶层 | Image | 保存 BGDefault图片，用于图片绘制或输出。 |
| 50 | result | const | drawPlayerDetail | 推断: ArrayLiteralExpression | 保存当前函数最终返回或阶段性处理结果。 |
| 51 | player | let | drawPlayerDetail | 推断: NewExpression | 变量，在 drawPlayerDetail 中保存 玩家 值，供当前逻辑读取或更新。 |
| 71 | list | const | drawPlayerDetail | Array<Canvas \| Image> | 变量，在 drawPlayerDetail 中保存 列表 值，供当前逻辑读取或更新。 |
| 77 | stat | const | drawPlayerDetail | 推断: AwaitExpression | 变量，在 drawPlayerDetail 中保存 数值 值，供当前逻辑读取或更新。 |
| 150 | all | const | drawPlayerDetail | Array<Canvas \| Image> | 变量，在 drawPlayerDetail 中保存 all 值，供当前逻辑读取或更新。 |
| 153 | listImage | const | drawPlayerDetail | 推断: CallExpression | 保存 列表图片，用于图片绘制或输出。 |
| 155 | buffer | const | drawPlayerDetail | 推断: AwaitExpression | 保存图片、SVG 或接口下载得到的二进制缓冲区。 |

### command-renderers/song-chart.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 20 | drawSongChart | function | 模块顶层 | songId: number; difficultyId: number; displayedServerList: Server[]; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制歌曲谱面。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 26 | song | const | drawSongChart | 推断: NewExpression | 保存当前歌曲领域模型实例。 |
| 34 | server | const | drawSongChart | 推断: CallExpression | 保存当前目标服务器枚举或服务器代码。 |
| 35 | band | const | drawSongChart | 推断: NewExpression | 变量，在 drawSongChart 中保存 乐队 值，供当前逻辑读取或更新。 |
| 36 | bandName | const | drawSongChart | 推断: ElementAccessExpression | 变量，在 drawSongChart 中保存 乐队名称 值，供当前逻辑读取或更新。 |
| 37 | songChart | const | drawSongChart | 推断: AwaitExpression | 变量，在 drawSongChart 中保存 歌曲谱面 值，供当前逻辑读取或更新。 |
| 39 | tempCanvas | const | drawSongChart | 推断: AwaitExpression | 保存 临时画布，用于图片绘制或输出。 |
| 52 | buffer | let | drawSongChart | Buffer | 保存图片、SVG 或接口下载得到的二进制缓冲区。 |

### command-renderers/song-detail.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 33 | drawSongDetail | function | 模块顶层 | song: Song; displayedServerList: Server[]; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制歌曲详情。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 42 | list | const | drawSongDetail | Array<Image \| Canvas> | 变量，在 drawSongDetail 中保存 列表 值，供当前逻辑读取或更新。 |
| 48 | typeImage | const | drawSongDetail | 推断: CallExpression | 保存 类型图片，用于图片绘制或输出。 |
| 53 | idImage | const | drawSongDetail | 推断: CallExpression | 保存 ID图片，用于图片绘制或输出。 |
| 61 | band | const | drawSongDetail | 推断: NewExpression | 变量，在 drawSongDetail 中保存 乐队 值，供当前逻辑读取或更新。 |
| 103 | bpmList | const | drawSongDetail | number[] | 保存 BPM列表，用于按顺序遍历或批量渲染。 |
| 104 | difficulty | const | drawSongDetail | 推断 | 变量，在 drawSongDetail 中保存 难度 值，供当前逻辑读取或更新。 |
| 105 | bpmId | let | drawSongDetail | 推断: FirstLiteralToken | 保存 BPMID，用于定位对应业务实体。 |
| 106 | element | const | drawSongDetail | 推断: ElementAccessExpression | 变量，在 drawSongDetail 中保存 element 值，供当前逻辑读取或更新。 |
| 110 | bpm | let | drawSongDetail | 推断: StringLiteral | 变量，在 drawSongDetail 中保存 BPM 值，供当前逻辑读取或更新。 |
| 111 | bpmMax | const | drawSongDetail | 推断: CallExpression | 变量，在 drawSongDetail 中保存 BPM最大值 值，供当前逻辑读取或更新。 |
| 112 | bpmMin | const | drawSongDetail | 推断: CallExpression | 变量，在 drawSongDetail 中保存 BPM最小值 值，供当前逻辑读取或更新。 |
| 161 | listImage | const | drawSongDetail | 推断: CallExpression | 保存 列表图片，用于图片绘制或输出。 |
| 162 | all | const | drawSongDetail | 推断: ArrayLiteralExpression | 变量，在 drawSongDetail 中保存 all 值，供当前逻辑读取或更新。 |
| 166 | songDataBlockImage | const | drawSongDetail | 推断: AwaitExpression | 保存 歌曲数据块图片，用于图片绘制或输出。 |
| 172 | feverStatusList | const | drawSongDetail | 推断: ArrayLiteralExpression | 保存 fever状态列表，用于按顺序遍历或批量渲染。 |
| 173 | j | let | drawSongDetail | 推断: FirstLiteralToken | 保存嵌套循环下标或对象键。 |
| 174 | feverStatus | const | drawSongDetail | 推断: ElementAccessExpression | 变量，在 drawSongDetail 中保存 fever状态 值，供当前逻辑读取或更新。 |
| 175 | songMetaListDataBlockImage | const | drawSongDetail | 推断: AwaitExpression | 保存 歌曲Meta列表数据块图片，用于图片绘制或输出。 |
| 185 | eventIdList | const | drawSongDetail | 推断: ArrayLiteralExpression | 保存 活动ID列表，用于按顺序遍历或批量渲染。 |
| 186 | i | let | drawSongDetail | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 187 | server | const | drawSongDetail | 推断: ElementAccessExpression | 保存当前目标服务器枚举或服务器代码。 |
| 191 | event | const | drawSongDetail | 推断: CallExpression | 保存当前活动领域模型实例。 |
| 194 | eventDataBlockImage | const | drawSongDetail | 推断: AwaitExpression | 保存 活动数据块图片，用于图片绘制或输出。 |

### command-renderers/song-list.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 53 | drawSongList | function | 模块顶层 | matches: FuzzySearchResult; displayedServerList: Server[]; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制歌曲列表。 |
| 127 | createEntity | arrow-function | matchSongList | songId: 推断 | 推断 | 在QQBot 图片视图层中创建Entity。 |
| 134 | isReleased | arrow-function | matchSongList | song: 推断; displayedServerList: 推断 | 推断 | 在QQBot 图片视图层中判断Released。 |
| 135 | <anonymous> | callback | matchSongList | server: 推断 | 推断 | 作为 \`displayedServerList.some\` 的回调，处理 server。 |
| 142 | isMatched | arrow-function | matchSongList | matches: 推断; song: 推断 | 推断 | 在QQBot 图片视图层中判断Matched。 |
| 148 | relationValue | arrow-function | matchSongList | song: 推断 | 推断 | 在QQBot 图片视图层中处理关系表达式值。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 20 | line | const | 模块顶层 | 推断: CallExpression | 变量，在 模块顶层 中保存 line 值，供当前逻辑读取或更新。 |
| 33 | line2 | const | 模块顶层 | Canvas | 变量，在 模块顶层 中保存 line2 值，供当前逻辑读取或更新。 |
| 59 | tempSongList | const | drawSongList | 推断: CallExpression | 保存 临时歌曲列表，用于按顺序遍历或批量渲染。 |
| 68 | maxHeight | const | drawSongList | 推断: FirstLiteralToken | 变量，在 drawSongList 中保存 最大值高度 值，供当前逻辑读取或更新。 |
| 70 | tempSongImageList | let | drawSongList | Canvas[] | 保存 临时歌曲图片列表，用于按顺序遍历或批量渲染。 |
| 71 | songImageListHorizontal | const | drawSongList | Canvas[] | 变量，在 drawSongList 中保存 歌曲图片列表Horizontal 值，供当前逻辑读取或更新。 |
| 72 | tempH | let | drawSongList | 推断: FirstLiteralToken | 变量，在 drawSongList 中保存 临时H 值，供当前逻辑读取或更新。 |
| 73 | songPromises | const | drawSongList | Promise<Canvas>[] | 变量，在 drawSongList 中保存 歌曲异步任务列表 值，供当前逻辑读取或更新。 |
| 75 | i | let | drawSongList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 86 | songImages | const | drawSongList | 推断: AwaitExpression | 变量，在 drawSongList 中保存 歌曲图片列表 值，供当前逻辑读取或更新。 |
| 88 | i | let | drawSongList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 89 | tempImage | const | drawSongList | 推断: ElementAccessExpression | 保存 临时图片，用于图片绘制或输出。 |
| 109 | songListImage | const | drawSongList | 推断: CallExpression | 保存 歌曲列表图片，用于图片绘制或输出。 |
| 113 | all | const | drawSongList | 推断: ArrayLiteralExpression | 变量，在 drawSongList 中保存 all 值，供当前逻辑读取或更新。 |
| 120 | matchSongList | const | 模块顶层 | 推断: CallExpression | 保存 匹配歌曲列表，用于按顺序遍历或批量渲染。 |

### command-renderers/song-meta-list.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 35 | drawSongMetaList | function | 模块顶层 | mainServer: Server; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制歌曲Meta列表。 |
| 58 | drawMetaRankListDataBlock | function | 模块顶层 | withFever: boolean; mainServer: Server | Promise<Canvas> | 在QQBot 图片视图层中绘制MetaRank列表数据块。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 16 | line | const | 模块顶层 | 推断: CallExpression | 变量，在 模块顶层 中保存 line 值，供当前逻辑读取或更新。 |
| 39 | feverMode | const | drawSongMetaList | 推断: ArrayLiteralExpression | 变量，在 drawSongMetaList 中保存 feverMode 值，供当前逻辑读取或更新。 |
| 40 | imageList | const | drawSongMetaList | 推断: ArrayLiteralExpression | 保存 图片列表，用于按顺序遍历或批量渲染。 |
| 41 | i | let | drawSongMetaList | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 42 | element | const | drawSongMetaList | 推断: ElementAccessExpression | 变量，在 drawSongMetaList 中保存 element 值，供当前逻辑读取或更新。 |
| 45 | all | const | drawSongMetaList | 推断: ArrayLiteralExpression | 变量，在 drawSongMetaList 中保存 all 值，供当前逻辑读取或更新。 |
| 62 | metaRanking | const | drawMetaRankListDataBlock | 推断: CallExpression | 变量，在 drawMetaRankListDataBlock 中保存 MetaRanking 值，供当前逻辑读取或更新。 |
| 63 | maxMeta | const | drawMetaRankListDataBlock | 推断: PropertyAccessExpression | 变量，在 drawMetaRankListDataBlock 中保存 最大值Meta 值，供当前逻辑读取或更新。 |
| 64 | list | const | drawMetaRankListDataBlock | Array<Canvas> | 变量，在 drawMetaRankListDataBlock 中保存 列表 值，供当前逻辑读取或更新。 |
| 65 | i | let | drawMetaRankListDataBlock | 推断: FirstLiteralToken | 保存循环下标或对象键。 |
| 66 | song | const | drawMetaRankListDataBlock | 推断: NewExpression | 保存当前歌曲领域模型实例。 |
| 67 | difficultyId | const | drawMetaRankListDataBlock | 推断: PropertyAccessExpression | 保存 难度ID，用于定位对应业务实体。 |
| 68 | percent | let | drawMetaRankListDataBlock | 推断: BinaryExpression | 变量，在 drawMetaRankListDataBlock 中保存 percent 值，供当前逻辑读取或更新。 |
| 80 | topLeftText | const | drawMetaRankListDataBlock | 推断: ConditionalExpression | 变量，在 drawMetaRankListDataBlock 中保存 topLeft文本 值，供当前逻辑读取或更新。 |

### command-renderers/song-random.ts

#### 函数

| 行 | 名称 | 类型 | 范围 | 参数 | 返回 | 用途 |
| --- | --- | --- | --- | --- | --- | --- |
| 19 | drawSongRandom | function | 模块顶层 | matches: FuzzySearchResult; displayedServerList: Server[]; useEasyBG: boolean; compress: boolean | Promise<Array<Buffer \| string>> | 在QQBot 图片视图层中绘制歌曲Random。 |
| 60 | getRandomInt | function | 模块顶层 | max: number | number | 在QQBot 图片视图层中获取RandomInt。 |

#### 变量与字段

| 行 | 名称 | 类型 | 范围 | TS 类型/推断 | 用途 |
| --- | --- | --- | --- | --- | --- |
| 26 | tempSongList | const | drawSongRandom | Array<Song> | 保存 临时歌曲列表，用于按顺序遍历或批量渲染。 |
| 33 | randomIndex | const | drawSongRandom | 推断: CallExpression | 变量，在 drawSongRandom 中保存 random下标 值，供当前逻辑读取或更新。 |
| 34 | song | const | drawSongRandom | 推断: ElementAccessExpression | 保存当前歌曲领域模型实例。 |
| 36 | all | const | drawSongRandom | 推断: ArrayLiteralExpression | 变量，在 drawSongRandom 中保存 all 值，供当前逻辑读取或更新。 |
| 40 | songDataBlockImage | const | drawSongRandom | 推断: AwaitExpression | 保存 歌曲数据块图片，用于图片绘制或输出。 |
| 43 | songJacket | const | drawSongRandom | 推断: AwaitExpression | 变量，在 drawSongRandom 中保存 歌曲封面 值，供当前逻辑读取或更新。 |
