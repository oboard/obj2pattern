import numpy as np
import matplotlib.pyplot as plt
import networkx as nx
import trimesh
from scipy.sparse.csgraph import shortest_path

# 读取 monkey.obj 文件
mesh = trimesh.load_mesh('monkey.obj')

# 获取顶点和面片数据
vertices = mesh.vertices
faces = mesh.faces

# 创建一个新的 3D 图形
fig = plt.figure(figsize=(10, 10))
ax = fig.add_subplot(111, projection='3d')

# 绘制网格模型
# 使用三角形面片绘制模型
for face in faces:
    x = vertices[face, 0]
    y = vertices[face, 1]
    z = vertices[face, 2]
    # 绘制每个三角形面片的边
    ax.plot([x[0], x[1]], [y[0], y[1]], [z[0], z[1]], 'b-', alpha=0.5)
    ax.plot([x[1], x[2]], [y[1], y[2]], [z[1], z[2]], 'b-', alpha=0.5)
    ax.plot([x[2], x[0]], [y[2], y[0]], [z[2], z[0]], 'b-', alpha=0.5)

# 设置坐标轴标签
ax.set_xlabel('X')
ax.set_ylabel('Y')
ax.set_zlabel('Z')

# 调整视角
ax.view_init(elev=20, azim=45)

# 显示图形
plt.show()


