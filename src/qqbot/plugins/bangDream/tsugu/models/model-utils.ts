import * as XLSX from 'xlsx';
import * as fs from 'fs';

/**
 * 在BangDream 领域模型层中读取JSON。
 *
 * @param filepath - filepath参数。
 * @returns 异步处理结果。
 */
export async function readJSON(filepath: string): Promise<object> {
  //读取json文件子程序，返回json数据
  const promise: object = new Promise(function (resolve) {
    const rawdata = fs.readFileSync(filepath);
    const rawstring = rawdata.toString();
    const data: object = JSON.parse(rawstring);
    resolve(data);
  });
  return promise;
}
/**
 * 在BangDream 领域模型层中读取JSONFrom缓冲区。
 *
 * @param buffer - 图片或下载结果缓冲区。
 * @returns 异步处理结果。
 */
export async function readJSONFromBuffer(buffer: Buffer): Promise<object> {
  //读取json文件子程序，返回json数据
  const rawstring = buffer.toString();
  const data: object = JSON.parse(rawstring);
  return data;
}

/**
 * 在BangDream 领域模型层中写入JSON。
 *
 * @param filepath - filepath参数。
 * @param data - 业务数据对象。
 */
export async function writeJSON(filepath: string, data: object) {
  //写入json文件子程序
  const rawdata = JSON.stringify(data);
  fs.writeFileSync(filepath, rawdata);
}

/**
 * 在BangDream 领域模型层中读取ExcelFile。
 *
 * @param filePath - 本地文件路径。
 * @returns 异步处理结果。
 */
export async function readExcelFile(filePath: string): Promise<any[]> {
  // 读取Excel文件
  const workbook = XLSX.readFile(filePath);

  // 获取工作表的名字
  const sheetName = workbook.SheetNames[0];

  // 获取工作表
  const worksheet = workbook.Sheets[sheetName];

  // 将工作表转换为JSON
  const json = XLSX.utils.sheet_to_json(worksheet);

  return json;
}

//将string[]转变为number[]
/**
 * 在BangDream 领域模型层中处理stringTo数字Array。
 *
 * @param stringArray - stringArray参数。
 * @returns 计算后的数值。
 */
export function stringToNumberArray(
  stringArray: Array<string | null>,
): number[] {
  const numberArray: number[] = [];
  for (let i = 0; i < stringArray.length; i++) {
    if (stringArray[i] == null) {
      numberArray.push(null);
    } else {
      numberArray.push(Number(stringArray[i]));
    }
  }
  return numberArray;
}

/**
 * 在BangDream 领域模型层中格式化数字。
 *
 * @param num - num参数。
 * @param length - length参数。
 * @returns 格式化后的文本。
 */
export function formatNumber(num: number, length: number): string {
  // 将数字转换为字符串
  const str = num.toString();

  // 如果字符串长度小于3，前面补0直到长度为3
  if (str.length < length) {
    return str.padStart(length, '0');
  }

  return str;
}

//栈函数
export class Stack<T> {
  stack: T[];
  private maxLength: number;

  /**
   * 构造 Stack 实例，并初始化该模型的本地基础字段。
   *
   * @param maxLength - maxLength参数。
   */
  constructor(maxLength: number) {
    this.stack = [];
    this.maxLength = maxLength;
  }

  /**
   * 在 Stack 模型中推入当前数据。
   *
   * @param item - 当前列表项。
   */
  push(item: T): void {
    this.stack.unshift(item); // 将新元素插入到堆栈的最前面

    if (this.stack.length > this.maxLength) {
      this.stack.pop(); // 如果堆栈长度超过指定的最大长度，自动弹出最后一个元素
    }
  }

  /**
   * 在 Stack 模型中处理pop。
   *
   * @returns 处理结果。
   */
  pop(): T | undefined {
    return this.stack.shift(); // 弹出并返回最前面的元素
  }

  /**
   * 在 Stack 模型中判断Empty。
   *
   * @returns 判断结果。
   */
  isEmpty(): boolean {
    return this.stack.length === 0;
  }

  /**
   * 在 Stack 模型中处理size。
   *
   * @returns 计算后的数值。
   */
  size(): number {
    return this.stack.length;
  }

  /**
   * 在 Stack 模型中清理当前数据。
   */
  clear(): void {
    this.stack = [];
  }
}
