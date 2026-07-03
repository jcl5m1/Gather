import numpy as np
import matplotlib.pyplot as plt

# Define the effective potential function
def effective_potential(x, y):
    p1 = np.array([1, 1])
    p2 = np.array([-0.5, 0])
    d1 = p1[0] - x, p1[1] - y
    d2 = p2[0] - x, p2[1] - y
    d1 = np.sqrt(d1[0]**2 + d1[1]**2)
    d2 = np.sqrt(d2[0]**2 + d2[1]**2)
    return -0.5 * (x**2 + y**2) - (1 / d1) - (1 / d2)
#    return 0 - (1 / np.sqrt((x - 1)**2 + y**2)) - (1 / np.sqrt((x + 1)**2 + y**2))

# Create a grid of points
x = np.linspace(-2, 2, 100)
y = np.linspace(-2, 2, 100)

# Calculate the effective potential at each point
Z = effective_potential(x[:, np.newaxis], y)

# Plot the effective potential lines
plt.contour(x, y, Z, levels=200)

# Find the Lagrange points
L1 = np.array([1, 0])
L2 = np.array([-1, 0])
L3 = np.array([0, 0])

# Plot the Lagrange points
plt.plot(L1[0], L1[1], 'ro', label='L1')
plt.plot(L2[0], L2[1], 'go', label='L2')
plt.plot(L3[0], L3[1], 'bo', label='L3')

# Add a legend
plt.legend()

# Show the plot
plt.show()