# Compatibility fixes for Ruby versions that removed taint/untrust APIs.
# Ruby 3.2 removed the `taint`, `untaint`, and `tainted?` APIs from core.
# Some gems (Liquid, older plugins) still call these methods on arbitrary
# objects (Strings, Arrays, etc). Provide no-op implementations on Object so
# those calls don't raise NoMethodError.
unless Object.method_defined?(:tainted?)
  class Object
    # Always report not tainted under modern Ruby's safe model.
    def tainted?
      false
    end

    # No-op: return self for chaining.
    def taint
      self
    end

    # No-op: return self for chaining.
    def untaint
      self
    end
  end
end
# Compatibility fixes for Ruby versions that removed Object#untaint / String#untaint.
# Liquid (and other gems) may call `untaint` on strings; newer Rubies (3.2+) removed this API.
# Define a no-op `untaint` to prevent NoMethodError.
if !String.method_defined?(:untaint)
  class String
    # Return self so callers can chain as before.
    def untaint
      self
    end
    # `tainted?` and `taint` were removed in newer Rubies; provide no-op versions
    # so libraries that check object tainting continue to work.
    def tainted?
      false
    end

    def taint
      self
    end
  end
end
