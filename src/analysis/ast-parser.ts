import ts from 'typescript';
import fs from 'fs';
import path from 'path';

export interface SymbolInfo {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'variable';
  line: number;
  exported: boolean;
  filePath: string;
}

export interface ImportInfo {
  source: string;
  names: string[];
  isDefault: boolean;
  isNamespace: boolean;
  line: number;
}

export interface ExportInfo {
  name: string;
  kind: string;
  line: number;
  isDefault: boolean;
}

export interface ParsedFile {
  filePath: string;
  symbols: SymbolInfo[];
  imports: ImportInfo[];
  exports: ExportInfo[];
  linesOfCode: number;
}

export class AstParser {
  private program: ts.Program | null = null;
  private sourceFiles: Map<string, ts.SourceFile> = new Map();

  constructor(private cwd: string) {}

  /** Create a TypeScript program from the project's tsconfig */
  initialize(): void {
    const tsconfigPath = ts.findConfigFile(this.cwd, ts.sys.fileExists, 'tsconfig.json');
    if (tsconfigPath) {
      const configFile = ts.readConfigFile(tsconfigPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, this.cwd);
      this.program = ts.createProgram(parsed.fileNames, parsed.options);
    } else {
      // No tsconfig - create a minimal program
      this.program = ts.createProgram([], {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        allowJs: true,
        esModuleInterop: true,
        skipLibCheck: true,
      });
    }
  }

  /** Parse a single file and extract symbols, imports, exports */
  parseFile(filePath: string): ParsedFile | null {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const sourceFile = ts.createSourceFile(
        filePath,
        content,
        ts.ScriptTarget.ES2022,
        true,
      );
      this.sourceFiles.set(filePath, sourceFile);

      const symbols: SymbolInfo[] = [];
      const imports: ImportInfo[] = [];
      const exports: ExportInfo[] = [];

      const visit = (node: ts.Node) => {
        // Extract symbols
        if (ts.isFunctionDeclaration(node) && node.name) {
          const isExport = this.hasExportModifier(node);
          symbols.push({
            name: node.name.text,
            kind: 'function',
            line: this.getLineNumber(sourceFile, node.getStart()),
            exported: isExport,
            filePath,
          });
          if (isExport) exports.push({ name: node.name.text, kind: 'function', line: this.getLineNumber(sourceFile, node.getStart()), isDefault: false });
        }
        else if (ts.isClassDeclaration(node) && node.name) {
          const isExport = this.hasExportModifier(node);
          symbols.push({
            name: node.name.text,
            kind: 'class',
            line: this.getLineNumber(sourceFile, node.getStart()),
            exported: isExport,
            filePath,
          });
          if (isExport) exports.push({ name: node.name.text, kind: 'class', line: this.getLineNumber(sourceFile, node.getStart()), isDefault: false });
        }
        else if (ts.isInterfaceDeclaration(node)) {
          const isExport = this.hasExportModifier(node);
          symbols.push({
            name: node.name.text,
            kind: 'interface',
            line: this.getLineNumber(sourceFile, node.getStart()),
            exported: isExport,
            filePath,
          });
          if (isExport) exports.push({ name: node.name.text, kind: 'interface', line: this.getLineNumber(sourceFile, node.getStart()), isDefault: false });
        }
        else if (ts.isTypeAliasDeclaration(node)) {
          const isExport = this.hasExportModifier(node);
          symbols.push({
            name: node.name.text,
            kind: 'type',
            line: this.getLineNumber(sourceFile, node.getStart()),
            exported: isExport,
            filePath,
          });
          if (isExport) exports.push({ name: node.name.text, kind: 'type', line: this.getLineNumber(sourceFile, node.getStart()), isDefault: false });
        }
        else if (ts.isEnumDeclaration(node)) {
          const isExport = this.hasExportModifier(node);
          symbols.push({
            name: node.name.text,
            kind: 'enum',
            line: this.getLineNumber(sourceFile, node.getStart()),
            exported: isExport,
            filePath,
          });
          if (isExport) exports.push({ name: node.name.text, kind: 'enum', line: this.getLineNumber(sourceFile, node.getStart()), isDefault: false });
        }
        else if (ts.isVariableStatement(node)) {
          const isExport = this.hasExportModifier(node);
          for (const decl of node.declarationList.declarations) {
            if (ts.isIdentifier(decl.name)) {
              symbols.push({
                name: decl.name.text,
                kind: 'const',
                line: this.getLineNumber(sourceFile, decl.getStart()),
                exported: isExport,
                filePath,
              });
              if (isExport) exports.push({ name: decl.name.text, kind: 'const', line: this.getLineNumber(sourceFile, decl.getStart()), isDefault: false });
            }
          }
        }
        // Extract imports
        else if (ts.isImportDeclaration(node)) {
          if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const source = node.moduleSpecifier.text;
            const info: ImportInfo = {
              source,
              names: [],
              isDefault: false,
              isNamespace: false,
              line: this.getLineNumber(sourceFile, node.getStart()),
            };
            if (node.importClause) {
              if (node.importClause.name) {
                info.names.push(node.importClause.name.text);
                info.isDefault = true;
              }
              if (node.importClause.namedBindings) {
                if (ts.isNamespaceImport(node.importClause.namedBindings)) {
                  info.names.push(node.importClause.namedBindings.name.text);
                  info.isNamespace = true;
                } else if (ts.isNamedImports(node.importClause.namedBindings)) {
                  for (const element of node.importClause.namedBindings.elements) {
                    info.names.push(element.name.text);
                  }
                }
              }
            }
            imports.push(info);
          }
        }
        // Extract export default
        else if (ts.isExportAssignment(node)) {
          exports.push({
            name: 'default',
            kind: 'export',
            line: this.getLineNumber(sourceFile, node.getStart()),
            isDefault: true,
          });
        }

        ts.forEachChild(node, visit);
      };

      visit(sourceFile);

      return {
        filePath,
        symbols,
        imports,
        exports,
        linesOfCode: content.split('\n').length,
      };
    } catch {
      return null;
    }
  }

  /** Find all definitions of a symbol across parsed files */
  findSymbol(name: string, parsedFiles: ParsedFile[]): SymbolInfo[] {
    const results: SymbolInfo[] = [];
    for (const file of parsedFiles) {
      for (const sym of file.symbols) {
        if (sym.name === name && sym.exported) {
          results.push(sym);
        }
      }
    }
    // If no exported found, return all matches
    if (results.length === 0) {
      for (const file of parsedFiles) {
        for (const sym of file.symbols) {
          if (sym.name === name) results.push(sym);
        }
      }
    }
    return results;
  }

  /** Get all imports for a file */
  getImports(filePath: string): ImportInfo[] {
    const sourceFile = this.sourceFiles.get(filePath);
    if (!sourceFile) {
      const parsed = this.parseFile(filePath);
      return parsed?.imports || [];
    }
    const parsed = this.parseFile(filePath);
    return parsed?.imports || [];
  }

  private hasExportModifier(node: ts.Node): boolean {
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    if (!modifiers) return false;
    return modifiers.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword);
  }

  private getLineNumber(sourceFile: ts.SourceFile, position: number): number {
    return sourceFile.getLineAndCharacterOfPosition(position).line + 1;
  }
}
