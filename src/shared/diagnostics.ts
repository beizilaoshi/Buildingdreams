export interface DiagnosticFile {name:string;text:string}
export interface DiagnosticFinding {id:string;title:string;evidence:string;suggestion:string}
export interface DiagnosticReport {schema:1;generatedAt:number;files:DiagnosticFile[];findings:DiagnosticFinding[];omitted:string[]}
