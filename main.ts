import fs from 'fs';

type Vertex = [number, number, number];  // 顶点坐标 (x, y, z)
type Edge = [number, number];           // 边的两个顶点索引
type Graph = Map<number, number[]>;     // 邻接表（顶点索引 → 相邻顶点索引）

export interface Instruction {
  type: string;
  count: number;
}

export interface StitchRound {
  roundNumber: number;
  instructions: Instruction[];
}

export interface StitchPart {
  id: string;
  description: string;
  rounds: StitchRound[];
}

/**
 * 从OBJ文件内容中解析对象名称
 * @param objContent OBJ文件内容
 * @returns 对象名称数组
 */
function parseObjNames(objContent: string): string[] {
  const objectNames: string[] = [];
  const lines = objContent.split('\n');

  lines.forEach(line => {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length >= 2 && tokens[0] === 'o') {
      objectNames.push(tokens[1]);
    }
  });

  // 如果没有找到对象名称，使用默认名称
  if (objectNames.length === 0) {
    objectNames.push('Object');
  }

  return objectNames;
}

function parseObjToGraph(objContent: string): { graph: Graph, vertices: Vertex[], objectNames: string[] } {
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];
  const objectNames = parseObjNames(objContent);

  // 按行解析.obj内容
  const lines = objContent.split('\n');
  lines.forEach(line => {
    const tokens = line.trim().split(/\s+/);
    if (tokens.length === 0) return;

    // 解析顶点（v 开头行）
    if (tokens[0] === 'v') {
      const [, x, y, z] = tokens.map(parseFloat);
      vertices.push([x, y, z]);
    }

    // 解析面（f 开头行）
    if (tokens[0] === 'f') {
      const faceVertices = tokens
        .slice(1)
        .map(token => {
          // 提取顶点索引（格式可能为 "1", "1/2", "1//3" 等）
          const index = parseInt(token.split('/')[0], 10);
          return index > 0 ? index - 1 : vertices.length + index; // 处理负索引
        });

      // 将面转换为边（多边形闭合边）
      for (let i = 0; i < faceVertices.length; i++) {
        const u = faceVertices[i];
        const v = faceVertices[(i + 1) % faceVertices.length];
        edges.push([Math.min(u, v), Math.max(u, v)]); // 去重边
      }
    }
  });

  // 去重边（Set → Array → 排序）
  const uniqueEdges = Array.from(
    new Set(
      edges.map(edge => JSON.stringify(edge))
    )
  ).map(str => JSON.parse(str) as Edge);

  // 构建邻接表
  const graph: Graph = new Map();
  vertices.forEach((_, index) => graph.set(index, [])); // 初始化所有顶点

  uniqueEdges.forEach(([u, v]) => {
    graph.get(u)?.push(v);  // 添加 u → v
    graph.get(v)?.push(u);  // 添加 v → u（无向图）
  });

  return { graph, vertices, objectNames };
}

/**
 * 计算两个顶点之间的欧几里得距离
 * @param v1 第一个顶点坐标
 * @param v2 第二个顶点坐标
 * @returns 两点之间的距离
 */
function calculateDistance(v1: Vertex, v2: Vertex): number {
  const dx = v2[0] - v1[0];
  const dy = v2[1] - v1[1];
  const dz = v2[2] - v1[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * 计算图中所有相邻顶点之间的距离
 * @param graph 邻接表表示的图
 * @param vertices 顶点坐标数组
 * @returns 边到距离的映射
 */
function calculateEdgeDistances(graph: Graph, vertices: Vertex[]): Map<string, number> {
  const distances = new Map<string, number>();

  // 遍历所有边
  graph.forEach((neighbors, vertex) => {
    neighbors.forEach(neighbor => {
      // 确保每条边只计算一次（使用较小的顶点索引作为键的第一部分）
      const edgeKey = vertex < neighbor
        ? `${vertex}-${neighbor}`
        : `${neighbor}-${vertex}`;

      if (!distances.has(edgeKey)) {
        const distance = calculateDistance(vertices[vertex], vertices[neighbor]);
        distances.set(edgeKey, distance);
      }
    });
  });

  return distances;
}

/**
 * 归一化距离，使最短距离为1，最长距离为4
 * @param distances 原始距离映射
 * @returns 归一化后的距离映射
 */
function normalizeDistances(distances: Map<string, number>): Map<string, number> {
  // 找出最小和最大距离
  let minDistance = Infinity;
  let maxDistance = -Infinity;

  distances.forEach(distance => {
    minDistance = Math.min(minDistance, distance);
    maxDistance = Math.max(maxDistance, distance);
  });

  // 创建新的归一化距离映射
  const normalizedDistances = new Map<string, number>();

  // 如果最小距离等于最大距离，所有归一化距离都设为1
  if (maxDistance === minDistance) {
    distances.forEach((_, edge) => {
      normalizedDistances.set(edge, 1);
    });
    return normalizedDistances;
  }

  // 归一化公式: newValue = 1 + 3 * (value - min) / (max - min)
  // 这样可以确保最小值映射到1，最大值映射到4
  distances.forEach((distance, edge) => {
    const normalizedDistance = 1 + 3 * (distance - minDistance) / (maxDistance - minDistance);
    normalizedDistances.set(edge, normalizedDistance);
  });

  return normalizedDistances;
}

/**
 * 将归一化的距离（1-4范围）转换为整数值（0-4范围）
 * @param normalizedDistances 归一化后的距离映射（1-4范围）
 * @returns 整数化后的距离映射（0-4范围）
 */
function discretizeDistances(normalizedDistances: Map<string, number>): Map<string, number> {
  const discretizedDistances = new Map<string, number>();

  normalizedDistances.forEach((distance, edge) => {
    // 将1-4范围的值映射到0-4的整数
    // 0: [0, 0.5)
    // 1: [0.5, 1.5)
    // 2: [1.5, 2.5)
    // 3: [2.5, 3.5)
    // 4: [3.5, 4]
    let discreteValue: number;

    if (distance < 0.5) {
      discreteValue = 0;
    } else if (distance < 1.5) {
      discreteValue = 1;
    } else if (distance < 2.5) {
      discreteValue = 2;
    } else if (distance < 3.5) {
      discreteValue = 3;
    } else {
      discreteValue = 4;
    }

    discretizedDistances.set(edge, discreteValue);
  });

  return discretizedDistances;
}

/**
 * 计算所有顶点对之间的距离
 * @param vertices 顶点坐标数组
 * @returns 顶点对到距离的映射
 */
function calculateAllVertexPairDistances(vertices: Vertex[]): Map<string, number> {
  const distances = new Map<string, number>();

  // 计算所有顶点对之间的距离
  for (let i = 0; i < vertices.length; i++) {
    for (let j = i + 1; j < vertices.length; j++) {
      const distance = calculateDistance(vertices[i], vertices[j]);
      const key = `${i}-${j}`;
      distances.set(key, distance);
    }
  }

  return distances;
}

/**
 * 将图的顶点分层
 * @param graph 邻接表表示的图
 * @param vertices 顶点坐标数组
 * @returns 分层后的顶点索引数组
 */
function layerGraph(graph: Graph, vertices: Vertex[]): number[][] {
  // 按照y坐标对顶点进行排序
  const verticesWithIndices = vertices.map((vertex, index) => ({ vertex, index }));

  // 按照y坐标排序（或者可以选择其他坐标轴）
  verticesWithIndices.sort((a, b) => a.vertex[1] - b.vertex[1]);

  // 找出不同的y坐标值
  const yValues = Array.from(new Set(vertices.map(v => v[1])));
  yValues.sort((a, b) => a - b);

  // 按照y坐标值分层
  const layers: number[][] = [];

  for (const y of yValues) {
    const layer = verticesWithIndices
      .filter(item => Math.abs(item.vertex[1] - y) < 0.0001) // 使用小阈值处理浮点数比较
      .map(item => item.index);

    if (layer.length > 0) {
      layers.push(layer);
    }
  }

  return layers;
}

/**
 * 使用BFS算法对图进行分层
 * @param graph 邻接表表示的图
 * @param startVertex 起始顶点
 * @returns 分层后的顶点索引数组
 */
function layerGraphBFS(graph: Graph, startVertex: number = 0): number[][] {
  const visited = new Set<number>();
  const layers: number[][] = [];

  // 初始层
  let currentLayer = [startVertex];
  visited.add(startVertex);

  // BFS遍历
  while (currentLayer.length > 0) {
    layers.push([...currentLayer]);

    const nextLayer: number[] = [];

    // 遍历当前层的所有顶点
    for (const vertex of currentLayer) {
      // 获取相邻顶点
      const neighbors = graph.get(vertex) || [];

      // 将未访问的相邻顶点加入下一层
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          nextLayer.push(neighbor);
        }
      }
    }

    currentLayer = nextLayer;
  }

  return layers;
}

/**
 * 将每层内边的整数化距离转换为图解语言
 * @param layers 分层后的顶点索引数组
 * @param graph 邻接表表示的图
 * @param vertices 顶点坐标数组
 * @param objectNames 对象名称数组
 * @returns 图解语言表示的对象数组
 */
function convertToStitchPattern(
  layers: number[][],
  graph: Graph,
  vertices: Vertex[],
  objectNames: string[]
): StitchPart[] {
  const stitchParts: StitchPart[] = [];

  // 为每个对象创建一个StitchPart
  objectNames.forEach((objectName, objectIndex) => {
    const rounds: StitchRound[] = [];

    // 每一层对应一个Round
    layers.forEach((layer, layerIndex) => {
      const instructions: Instruction[] = [];

      // 收集该层内的所有边
      const layerEdges = new Map<string, number>();

      // 遍历该层的所有顶点
      for (const vertex of layer) {
        // 获取该顶点的所有邻居
        const neighbors = graph.get(vertex) || [];

        // 只考虑同一层内的边
        for (const neighbor of neighbors) {
          if (layer.includes(neighbor) && vertex < neighbor) { // 确保每条边只处理一次
            const distance = calculateDistance(vertices[vertex], vertices[neighbor]);
            const edgeKey = `${vertex}-${neighbor}`;
            layerEdges.set(edgeKey, distance);
          }
        }
      }

      // 如果该层没有边，跳过
      if (layerEdges.size === 0) {
        return;
      }

      // 归一化该层内的边距离
      const normalizedLayerEdges = normalizeDistances(layerEdges);

      // 整数化该层内的边距离
      const discretizedLayerEdges = discretizeDistances(normalizedLayerEdges);

      // 将边的整数化距离转换为指令
      const instructionCounts = new Map<string, number>();

      // 统计每种类型指令的数量
      discretizedLayerEdges.forEach((distance, edge) => {
        const type = ["SL", layerIndex == 0 ? "CH" : "X", "T", "F", "E"][distance];
        instructionCounts.set(type, (instructionCounts.get(type) || 0) + 1);
      });

      // 将统计结果转换为指令数组
      instructionCounts.forEach((count, type) => {
        instructions.push({
          type,
          count
        });
      });

      // 如果有指令，添加到rounds中
      if (instructions.length > 0) {
        rounds.push({
          roundNumber: layerIndex + 1,
          instructions
        });
      }
    });

    // 创建StitchPart
    stitchParts.push({
      id: (objectIndex + 1).toString(),
      description: objectName,
      rounds
    });
  });

  return stitchParts;
}

/**
 * 将图解结构体转换为可读的图解文字
 * @param stitchParts 图解结构体数组
 * @returns 可读的图解文字
 */
function convertToReadablePattern(stitchParts: StitchPart[]): string {
  let result = '';

  stitchParts.forEach(part => {
    // 添加部件标题
    result += `P${part.id}: ${part.description}\n`;

    // 添加每一轮的指令
    part.rounds.forEach(round => {
      // 开始一个新的轮次
      result += `R${round.roundNumber}: `;

      // 添加该轮的所有指令
      const instructionTexts = round.instructions.map(instruction => {
        return `${instruction.count}${instruction.type}`;
      });

      // 将指令连接起来
      result += instructionTexts.join(', ');
      result += '\n';
    });

    // 在不同部件之间添加空行
    result += '\n';
  });

  return result.trim();
}

// 示例使用
const objContent = fs.readFileSync('cube.obj', 'utf-8');
const { graph, vertices, objectNames } = parseObjToGraph(objContent);

// 打印对象名称
console.log("对象名称:");
objectNames.forEach((name, index) => {
  console.log(`对象 ${index + 1}: ${name}`);
});

// 打印邻接表
console.log("\n邻接表:");
graph.forEach((neighbors, vertex) => {
  console.log(`顶点 ${vertex}: [${neighbors.join(', ')}]`);
});

// 计算并打印边的距离
console.log("\n边的距离:");
const edgeDistances = calculateEdgeDistances(graph, vertices);
edgeDistances.forEach((distance, edge) => {
  console.log(`边 ${edge}: ${distance.toFixed(4)}`);
});

// 归一化并打印边的距离
console.log("\n归一化后的边距离 (1-4):");
const normalizedEdgeDistances = normalizeDistances(edgeDistances);
normalizedEdgeDistances.forEach((distance, edge) => {
  console.log(`边 ${edge}: ${distance.toFixed(4)}`);
});

// 整数化并打印边的距离
console.log("\n整数化后的边距离 (0-4):");
const discretizedEdgeDistances = discretizeDistances(normalizedEdgeDistances);
discretizedEdgeDistances.forEach((distance, edge) => {
  console.log(`边 ${edge}: ${distance}`);
});

// 按照几何坐标分层
console.log("\n按照几何坐标分层:");
const geometricLayers = layerGraph(graph, vertices);
geometricLayers.forEach((layer, index) => {
  console.log(`层 ${index}: [${layer.join(', ')}]`);
});

// 按照BFS分层
console.log("\n按照BFS分层:");
const bfsLayers = layerGraphBFS(graph, 0);
bfsLayers.forEach((layer, index) => {
  console.log(`层 ${index}: [${layer.join(', ')}]`);
});

const layers = geometricLayers;

// 打印每层内的边距离
console.log("\n每层内的边距离:");
layers.forEach((layer, layerIndex) => {
  console.log(`层 ${layerIndex}:`);

  // 收集该层内的所有边
  const layerEdges = new Map<string, number>();

  // 遍历该层的所有顶点
  for (const vertex of layer) {
    // 获取该顶点的所有邻居
    const neighbors = graph.get(vertex) || [];

    // 只考虑同一层内的边
    for (const neighbor of neighbors) {
      if (layer.includes(neighbor) && vertex < neighbor) { // 确保每条边只处理一次
        const distance = calculateDistance(vertices[vertex], vertices[neighbor]);
        const edgeKey = `${vertex}-${neighbor}`;
        layerEdges.set(edgeKey, distance);
        console.log(`  边 ${edgeKey}: ${distance.toFixed(4)}`);
      }
    }
  }

  // 如果该层没有边
  if (layerEdges.size === 0) {
    console.log("  该层内没有边");
  }
});

// 打印每层内边的归一化距离
console.log("\n每层内边的归一化距离 (1-4):");
layers.forEach((layer, layerIndex) => {
  console.log(`层 ${layerIndex}:`);

  // 收集该层内的所有边
  const layerEdges = new Map<string, number>();

  // 遍历该层的所有顶点
  for (const vertex of layer) {
    // 获取该顶点的所有邻居
    const neighbors = graph.get(vertex) || [];

    // 只考虑同一层内的边
    for (const neighbor of neighbors) {
      if (layer.includes(neighbor) && vertex < neighbor) { // 确保每条边只处理一次
        const distance = calculateDistance(vertices[vertex], vertices[neighbor]);
        const edgeKey = `${vertex}-${neighbor}`;
        layerEdges.set(edgeKey, distance);
      }
    }
  }

  // 如果该层没有边
  if (layerEdges.size === 0) {
    console.log("  该层内没有边");
    return;
  }

  // 归一化该层内的边距离
  const normalizedLayerEdges = normalizeDistances(layerEdges);
  normalizedLayerEdges.forEach((distance, edge) => {
    console.log(`  边 ${edge}: ${distance.toFixed(4)}`);
  });
});

// 打印每层内边的整数化距离
console.log("\n每层内边的整数化距离 (0-4):");
layers.forEach((layer, layerIndex) => {
  console.log(`层 ${layerIndex}:`);

  // 收集该层内的所有边
  const layerEdges = new Map<string, number>();

  // 遍历该层的所有顶点
  for (const vertex of layer) {
    // 获取该顶点的所有邻居
    const neighbors = graph.get(vertex) || [];

    // 只考虑同一层内的边
    for (const neighbor of neighbors) {
      if (layer.includes(neighbor) && vertex < neighbor) { // 确保每条边只处理一次
        const distance = calculateDistance(vertices[vertex], vertices[neighbor]);
        const edgeKey = `${vertex}-${neighbor}`;
        layerEdges.set(edgeKey, distance);
      }
    }
  }

  // 如果该层没有边
  if (layerEdges.size === 0) {
    console.log("  该层内没有边");
    return;
  }

  // 归一化该层内的边距离
  const normalizedLayerEdges = normalizeDistances(layerEdges);

  // 整数化该层内的边距离
  const discretizedLayerEdges = discretizeDistances(normalizedLayerEdges);
  discretizedLayerEdges.forEach((distance, edge) => {
    console.log(`  边 ${edge}: ${distance}`);
  });
});

// 转换为图解语言
const stitchPattern = convertToStitchPattern(layers, graph, vertices, objectNames);

// 打印图解语言
console.log("\n图解语言 (JSON格式):");
console.log(JSON.stringify(stitchPattern, null, 2));

// 转换为可读的图解文字
const readablePattern = convertToReadablePattern(stitchPattern);

// 打印可读的图解文字
console.log("\n图解语言 (可读文本格式):");
console.log(readablePattern);

// 将可读的图解文字保存到文件
// fs.writeFileSync('pattern.txt', readablePattern);
// console.log("\n图解语言已保存到 pattern.txt 文件"); 