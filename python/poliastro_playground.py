import torch
from torch import nn
from torchdiffeq import odeint

# Define the ODE as a PyTorch module
class ODE(nn.Module):
    def forward(self, t, y):
        return -y  # simple exponential decay

# Initial condition
y0 = torch.tensor([1.0])

# Time points where we want the solution
t = torch.linspace(0, 1, 100)

# Solve the ODE
ode = ODE()
solution = odeint(ode, y0, t)
print(solution)
# Now `solution` is a tensor of shape (100,) containing the solution at each time point