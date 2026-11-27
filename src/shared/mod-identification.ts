export type ModIdentificationItem = {fileName:string;sha1:string};
export type ModIdentificationSourceStatus = 'identified'|'unmatched'|'failed'|'unavailable'|'skipped';
export type ModIdentificationResult = {
  fileName:string;
  status:'identified'|'trusted'|'unmatched'|'failed'|'cancelled';
  projectId?:string;
  versionId?:string;
  error?:string;
  sources?:{modrinth:ModIdentificationSourceStatus;curseforge:ModIdentificationSourceStatus};
};
export const identificationScope = '仅处理你勾选的未知 JAR：先向 Modrinth 官方发送 SHA-1 精确查询；未匹配时，若已配置获准使用指纹接口的 CurseForge API Key，再向 CurseForge 官方发送本地计算的标准化指纹。第三方启动器需向 CurseForge 申请 API 使用权限，普通密钥可能无权访问。不会上传文件、文件名或本机路径，也不会按名称猜测。未匹配不代表文件无来源。';
