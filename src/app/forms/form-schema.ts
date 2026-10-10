// ------------------------------------------------------------------------
// 名称：form-schema.ts
// 说明：表单的结构描述：宿主生成，页面的表单引擎据此渲染控件并做即时校验。
// 作者：Lion
// 邮箱：chengbin@3578.cn
// 日期：2026-10-06
// 备注：所有字段值以文本传输：选择类字段未选择时为空串，多选（checkboxes）为 JSON 数组文本，文件（file）为“[{name, mimeType, size, data}]”的 JSON 文本（data 为 Base64）。
// ------------------------------------------------------------------------

/** 表单控件类型，对应界面组件库的控件：单行、多行、下拉、单选组、复选框组、文件选择。 */
export type FormControl = 'text' | 'textarea' | 'select' | 'radio' | 'checkboxes' | 'file';

/** 单个字段的描述。 */
export interface FormFieldSchema {
  /** 字段键，也是提交内容中的键。 */
  readonly key: string;
  readonly label: string;
  /** 标签下方的说明文字。 */
  readonly description: string;
  /** 说明文字随另一个字段所选的值变化：该字段的值在 byValue 里有对应文字时显示它，否则显示 description。 */
  readonly descriptionByValue?: {
    readonly sourceKey: string;
    readonly byValue: Readonly<Record<string, string>>;
  };
  /** 另一个字段的值被用户改变时，本字段的值跟着换成 byValue 里对应的内容（没有对应值时不动）；打开表单时不改初始值。 */
  readonly valueByValue?: {
    readonly sourceKey: string;
    readonly byValue: Readonly<Record<string, string>>;
  };
  readonly control: FormControl;
  readonly required: boolean;
  /** 最大长度，用于界面即时校验；宿主会再次校验。 */
  readonly maxLength?: number;
  /** 选项；仅 select、radio、checkboxes 使用。 */
  readonly options?: readonly string[];
  /** 字段只在来源字段的当前值属于 values 时显示；隐藏的字段不校验，提交时仍带着当前值，由宿主按需忽略。 */
  readonly visibleWhen?: {
    readonly sourceKey: string;
    readonly values: readonly string[];
  };
  /**
   * 选项随另一个字段所选的值变化：来源字段的值在 byValue 里有对应选项时换成它，没有时选项为空；原来所选的值不在新选项里时清空。
   * options 仍要给出打开表单时（来源字段为初始值）的选项；仅 select 使用。
   */
  readonly optionsByValue?: {
    readonly sourceKey: string;
    readonly byValue: Readonly<Record<string, readonly string[]>>;
  };
  /** 选项随可用模型实时刷新时，选中第一项（如“沿用默认（模型名）”）的字段改选新的第一项；仅 select 使用。 */
  readonly followsFirstOption?: boolean;
  /** 下拉框是否提供“其他（手动输入）”；仅 select 使用。 */
  readonly allowCustom?: boolean;
  /** 输入框的占位示例文字；下拉框用它作为“未选择”项（值为空串）的显示文字，不填为“请选择”。 */
  readonly placeholder?: string;
  /** 多行文本按内容增高的最大行数，超过后出现滚动条；不填用表单引擎的默认值；仅 textarea 使用。 */
  readonly maxRows?: number;
  /** 失去焦点时是否向宿主检查唯一性。 */
  readonly checkUnique?: boolean;
  /** 文件允许的扩展名（小写、含点）；仅 file 使用。 */
  readonly accept?: readonly string[];
  /** 是否可多选；仅 file 使用。 */
  readonly multiple?: boolean;
  /** 最多文件数；仅 file 使用。 */
  readonly maxFiles?: number;
  /** 单个文件大小上限（字节）；仅 file 使用，界面先拦截，宿主会再次校验。 */
  readonly maxFileBytes?: number;
  /** 文件的预览方式：image 为缩略图网格，点击查看原图；不填则按文件名列表显示；仅 file 使用。 */
  readonly preview?: 'image';
  /** 提交前由页面从文件中读取的附加信息：image 为缩略图与宽高，audio 为时长；不填则不读取；仅 file 使用。 */
  readonly derive?: 'image' | 'audio';
  /** 字段只读：显示当前值但不能修改，提交时仍带着该值。 */
  readonly disabled?: boolean;
}

/** 表单里的一个提交按钮：一个表单可以有多个，提交请求带所选按钮的键。 */
export interface FormSubmitActionSchema {
  readonly key: string;
  readonly label: string;
  /** 主按钮：突出显示，并负责回车提交；没有标记时最后一个是主按钮。 */
  readonly primary?: boolean;
  /** 非主按钮的强调色：'accent' 用警示黄区别于默认的次要灰（例如会替换当前内容的特殊操作），不填为默认次要样式；primary 为 true 时忽略。 */
  readonly tone?: 'accent';
  /** 按钮是否禁用：为 true 时置灰且不可点击，仍会渲染 note 说明原因。 */
  readonly disabled?: boolean;
  /** 按钮上方的说明文字：解释这个按钮的作用，或禁用时的原因；不填不显示。 */
  readonly note?: string;
  /** 提交前的覆盖确认：指定字段已有内容时询问；fields 为空表示总是询问（宿主已知要覆盖的内容不在表单里）。 */
  readonly confirmOverwrite?: {
    readonly fields: readonly string[];
    readonly title: string;
    readonly message: string;
    readonly confirmText?: string;
  };
}

/** 表单描述。 */
export interface FormSchema {
  /** 页面标题。 */
  readonly title: string;
  /** 提交按钮文字。 */
  readonly submitLabel: string;
  readonly fields: readonly FormFieldSchema[];
  /** 多个提交按钮；不填则只有 submitLabel 一个提交按钮。 */
  readonly submitActions?: readonly FormSubmitActionSchema[];
}
