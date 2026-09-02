"""Blocks which build the U-Net architecture"""

import torch
import torch.nn as nn
import torch.nn.functional as F
import math


def timestep_embedding(t, dim):
    half = dim // 2
    freqs = torch.exp(-math.log(10000) * torch.arange(half, device=t.device) / half)
    args = t[..., None].float() * freqs[None]
    return torch.cat([args.sin(), args.cos()], dim=-1)


class ResBlock(nn.Module):
    def __init__(self, in_ch, out_ch, time_dim):
        super().__init__()
        self.norm1 = nn.GroupNorm(8, in_ch)
        self.conv1 = nn.Conv2d(in_ch, out_ch, kernel_size=3, padding=1)
        self.norm2 = nn.GroupNorm(8, out_ch)
        self.conv2 = nn.Conv2d(out_ch, out_ch, kernel_size=3, padding=1)
        self.skip = nn.Conv2d(in_ch, out_ch, kernel_size=1, padding=0) if in_ch != out_ch else nn.Identity()
        self.time_proj = nn.Linear(time_dim, out_ch)
    
    def forward(self, x, temb):
        h = self.conv1(F.silu(self.norm1(x)))
        h = h + self.time_proj(temb)[:, :, None, None]
        h = self.conv2(F.silu(self.norm2(h)))
        return h + self.skip(x)


class AttentionBlock(nn.Module):
    def __init__(self, dim):
        super().__init__()
        self.norm = nn.GroupNorm(8, dim)
        self.attention = nn.MultiheadAttention(dim, num_heads=4, batch_first=True)
    
    def forward(self, x):
        a = self.norm(x)
        b, c, h, w = x.shape
        a = a.permute(0, 2, 3, 1).reshape(b, h * w, c)
        a = self.attention(a, a, a)[0]
        a = a.reshape(b, h, w, c).permute(0, 3, 1, 2)
        return a + x


class UNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.time_dim = 256
        self.sinusoid_dim = 64

        # stem
        self.stem_conv = nn.Conv2d(3, 64, kernel_size=3, padding=1)

        self.time_mlp = nn.Sequential(
            nn.Linear(self.sinusoid_dim, self.time_dim),
            nn.SiLU(),
            nn.Linear(self.time_dim, self.time_dim),
        )

        # down 1
        self.res1 = ResBlock(64, 64, self.time_dim)
        self.down1 = nn.Conv2d(64, 128, kernel_size=3, stride=2, padding=1)

        # down 2
        self.res2 = ResBlock(128, 128, self.time_dim)
        self.down2 = nn.Conv2d(128, 256, kernel_size=3, stride=2, padding=1)

        # bottleneck / attention
        self.res3 = ResBlock(256, 256, self.time_dim)
        self.attention = AttentionBlock(256)
        self.res4 = ResBlock(256, 256, self.time_dim)

        # up 1
        self.up1 = nn.Sequential(
            nn.Upsample(scale_factor=2),
            nn.Conv2d(256, 256, kernel_size=3, padding=1),
        )

        # up 2
        self.res5 = ResBlock(384, 128, self.time_dim)  # 384 = 256 + 128
        self.up2 = nn.Sequential(
            nn.Upsample(scale_factor=2),
            nn.Conv2d(128, 128, kernel_size=3, padding=1),
        )

        # head
        self.res6 = ResBlock(192, 64, self.time_dim)  # 192 = 128 + 64
        self.head_norm = nn.GroupNorm(8, 64)
        self.head_conv = nn.Conv2d(64, 1, kernel_size=3, padding=1)


    def forward(self, x, t):
        temb = self.time_mlp(timestep_embedding(t, self.sinusoid_dim))

        # stem
        x = self.stem_conv(x)

        # down 1
        x = self.res1(x, temb)
        skip_a = x
        x = self.down1(x)

        # down 2
        x = self.res2(x, temb)
        skip_b = x
        x = self.down2(x)

        # bottleneck / attention
        x = self.res3(x, temb)
        x = self.attention(x)
        x = self.res4(x, temb)

        # up 1
        x = self.up1(x)
        x = torch.cat([x, skip_b], dim=1)  # 256 + 128 = 384
        x = self.res5(x, temb)

        # up 2
        x = self.up2(x)
        x = torch.cat([x, skip_a], dim=1)  # 128 + 64 = 192
        x = self.res6(x, temb)

        # head
        x = self.head_norm(x)
        x = F.silu(x)
        x = self.head_conv(x)

        return x


if __name__ == "__main__":
    model = UNet()
    print("params:", sum(p.numel() for p in model.parameters()))
    x = torch.randn(4, 3, 24, 24); t = torch.randint(0, 1000, (4,))
    out = model(x, t)
    assert out.shape == (4, 1, 24, 24) and not out.isnan().any()
    out.mean().backward()
    assert all(p.grad is not None for p in model.parameters())
    with torch.no_grad():
        assert not torch.allclose(model(x, t.clone().fill_(10)), model(x, t.clone().fill_(900)))
    print("all checks passed")
